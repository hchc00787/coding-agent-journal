// Parses Claude Code session JSONL files into normalized session objects.
// Schema coverage is best-effort, based on third-party documented formats
// (claude-dev.tools JSONL format doc; markmdev/claude-skills transcript-schema.md).
// Coverage limits: sidechain events inside a file are included; separate subagent files are separate sessions;
// file-history-snapshot / progress / queue-operation lines are ignored.
// Standard sibling-session tool-results/<tool_use_id>.txt spill files are read for outcome evidence.
// Missing/truncated spills are labeled; structured .json spill files and arbitrary persistedOutputPath values are not followed.
import fs from 'node:fs';
import path from 'node:path';

export function* iterJsonlFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* iterJsonlFiles(p);
    else if (entry.name.endsWith('.jsonl')) yield p;
  }
}

export function parseSessionFile(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const events = [];
  const seenUuids = new Set();
  let skippedMalformed = 0, skippedDuplicate = 0;
  for (const line of lines) {
    let e;
    try { e = JSON.parse(line); } catch { skippedMalformed++; continue; }
    if (!e || typeof e !== 'object' || Array.isArray(e)) { skippedMalformed++; continue; }
    if (typeof e.uuid === 'string' && seenUuids.has(e.uuid)) { skippedDuplicate++; continue; }
    if (typeof e.uuid === 'string') seenUuids.add(e.uuid);
    events.push(e);
  }
  if (!events.length) return null;

  const session = {
    id: null, project: null, cwd: null, start: null, end: null,
    models: new Set(),
    usageByMessage: new Map(), // message.id -> usage (streamed lines repeat usage; dedupe)
    firstUserText: null, lastAssistantText: null,
    filesModified: new Set(), filesRead: new Set(), toolCalls: 0, bashCommands: 0,
    evidence: [], // signals observed in tool output text, never agent claims
    spill: { read: 0, missing: 0, truncated: 0 },
    skippedMalformed, skippedDuplicate,
  };

  const timestamps = [];
  let anon = 0;
  for (const e of events) {
    if (typeof e.sessionId === 'string') session.id ||= e.sessionId;
    if (typeof e.cwd === 'string') session.cwd ||= e.cwd;
    if (typeof e.timestamp === 'string' && !Number.isNaN(Date.parse(e.timestamp))) timestamps.push(e.timestamp);
    const msg = (e.message && typeof e.message === 'object' && !Array.isArray(e.message)) ? e.message : {};
    if (e.type === 'assistant') {
      if (typeof msg.model === 'string' && msg.model) session.models.add(msg.model);
      const key = typeof msg.id === 'string' ? msg.id : `anon:${anon++}`;
      if (msg.usage && typeof msg.usage === 'object' && !Array.isArray(msg.usage)) {
        session.usageByMessage.set(key, msg.usage); // last write wins per message.id
      } else if (!session.usageByMessage.has(key)) {
        session.usageByMessage.set(key, null); // assistant message with no usage: unknown, not zero
      }
      const blocks = (Array.isArray(msg.content) ? msg.content : []).filter(b => b && typeof b === 'object');
      for (const block of blocks) {
        if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) session.lastAssistantText = block.text;
        if (block.type === 'tool_use') {
          session.toolCalls++;
          if (block.name === 'Bash') session.bashCommands++;
          const inp = block.input && typeof block.input === 'object' ? block.input : {};
          const fp = typeof inp.file_path === 'string' ? inp.file_path : (typeof inp.path === 'string' ? inp.path : null);
          if (fp && ['Edit', 'MultiEdit', 'Write', 'NotebookEdit'].includes(block.name)) session.filesModified.add(fp);
          else if (fp && block.name === 'Read') session.filesRead.add(fp);
        }
      }
    }
    if (e.type === 'user') {
      const blocks = (Array.isArray(msg.content) ? msg.content : []).filter(b => b && typeof b === 'object');
      for (const block of blocks) {
        if (block.type === 'tool_result') {
          const parts = [];
          if (typeof block.content === 'string') parts.push(block.content);
          else if (Array.isArray(block.content))
            for (const c of block.content) if (c && c.type === 'text' && typeof c.text === 'string') parts.push(c.text);
          const inline = parts.join('\n');
          // Claude Code can spill large tool output beside the session. Follow only
          // filenames derived from the on-disk session layout and tool_use_id; never
          // follow an arbitrary path embedded in the log. Label expected-but-missing
          // spills so preview-only coverage is visible instead of silently degraded.
          const spilled = readSpilledToolResult(file, block.tool_use_id);
          if (spilled) {
            session.spill.read++;
            if (spilled.truncated) session.spill.truncated++;
            collectEvidence(spilled.text, session.evidence);
          } else {
            if (expectsSpilledToolResult(inline, e.toolUseResult)) session.spill.missing++;
            collectEvidence(inline, session.evidence);
          }
        }
      }
      if (!session.firstUserText) {
        const text = typeof msg.content === 'string' ? msg.content
          : blocks.filter(b => b.type === 'text' && typeof b.text === 'string').map(b => b.text).join(' ');
        if (text.trim() && !e.isMeta) session.firstUserText = text;
      }
    }
  }
  if (timestamps.length) {
    timestamps.sort();
    session.start = timestamps[0];
    session.end = timestamps[timestamps.length - 1];
  }
  session.project = session.cwd ? session.cwd.split(/[\\/]/).filter(Boolean).pop() : path.basename(path.dirname(file));
  const usage = { model: [...session.models][0] || null, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  usage.modelCount = session.models.size; usage.incomplete = false; usage.cacheFieldsMissing = false; usage.cache1h = false;
  const num = v => (typeof v === 'number' && Number.isFinite(v) && v >= 0) ? v : null;
  for (const u of session.usageByMessage.values()) {
    if (!u) { usage.incomplete = true; continue; }
    const i = num(u.input_tokens), o = num(u.output_tokens);
    if (i === null || o === null) usage.incomplete = true;
    const cr = num(u.cache_read_input_tokens), cw = num(u.cache_creation_input_tokens);
    // Absent cache fields: estimate is labeled. Present-but-invalid values: unknown, never a silent undercount.
    if ((u.cache_read_input_tokens !== undefined && cr === null) || (u.cache_creation_input_tokens !== undefined && cw === null)) usage.incomplete = true;
    if (cr === null || cw === null) usage.cacheFieldsMissing = true;
    const c1 = u.cache_creation && typeof u.cache_creation === 'object' ? u.cache_creation.ephemeral_1h_input_tokens : 0;
    if (typeof c1 === 'number' ? c1 > 0 : c1 != null) usage.cache1h = true;
    usage.inputTokens += i || 0;
    usage.outputTokens += o || 0;
    usage.cacheReadTokens += cr || 0;
    usage.cacheWriteTokens += cw || 0;
  }
  session.usage = usage;
  delete session.usageByMessage;
  return session;
}


// Reads standard Claude Code spill files for one tool result. The log is
// untrusted input, so this deliberately does not dereference persistedOutputPath
// or any other path string from the log. It derives only the normal sibling-session
// path (plus the shared parent-session path used by subagent transcripts), rejects
// symlinked spill locations, and caps reads. Large spills keep head and tail because
// test summaries commonly appear at the end.
const SPILL_READ_LIMIT = 5 * 1024 * 1024;
const SPILL_TAIL_KEEP = 1024 * 1024;

function spillCandidates(sessionFile, toolUseId) {
  const sessionId = path.basename(sessionFile, '.jsonl');
  const dir = path.dirname(sessionFile);
  const candidates = [{ root: path.join(dir, sessionId), file: path.join(dir, sessionId, 'tool-results', `${toolUseId}.txt`) }];
  // Subagent JSONL files live at <session-id>/subagents/agent-*.jsonl, while their
  // spilled tool output shares the parent session's tool-results directory.
  if (path.basename(dir) === 'subagents') {
    const parentSessionDir = path.dirname(dir);
    candidates.push({ root: parentSessionDir, file: path.join(parentSessionDir, 'tool-results', `${toolUseId}.txt`) });
  }
  return candidates;
}

function hasSymlinkComponent(root, target) {
  const rel = path.relative(root, target);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return true;
  let current = root;
  try {
    for (const part of ['.', ...rel.split(path.sep).filter(Boolean)]) {
      if (part !== '.') current = path.join(current, part);
      if (fs.lstatSync(current).isSymbolicLink()) return true;
    }
  } catch {
    return true;
  }
  return false;
}

function readFdCapped(fd, size) {
  if (size <= SPILL_READ_LIMIT) {
    const buf = Buffer.alloc(size);
    const n = fs.readSync(fd, buf, 0, size, 0);
    return { text: buf.toString('utf8', 0, n), truncated: false };
  }
  const headSize = SPILL_READ_LIMIT - SPILL_TAIL_KEEP;
  const head = Buffer.alloc(headSize);
  const headRead = fs.readSync(fd, head, 0, headSize, 0);
  const tail = Buffer.alloc(SPILL_TAIL_KEEP);
  const tailRead = fs.readSync(fd, tail, 0, SPILL_TAIL_KEEP, Math.max(0, size - SPILL_TAIL_KEEP));
  return {
    text: `${head.toString('utf8', 0, headRead)}\n...[tool output truncated: middle omitted]...\n${tail.toString('utf8', 0, tailRead)}`,
    truncated: true,
  };
}

function readSpillCandidate(root, spill) {
  try {
    if (hasSymlinkComponent(root, spill)) return null;
    const st = fs.lstatSync(spill);
    if (!st.isFile()) return null;
    const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
    const fd = fs.openSync(spill, flags);
    try {
      return readFdCapped(fd, st.size);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

function readSpilledToolResult(sessionFile, toolUseId) {
  if (typeof toolUseId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(toolUseId)) return null;
  for (const candidate of spillCandidates(sessionFile, toolUseId)) {
    const result = readSpillCandidate(candidate.root, candidate.file);
    if (result) return result;
  }
  return null;
}

function expectsSpilledToolResult(inlineText, toolUseResult) {
  if (/<persisted-output>[\s\S]*Full output saved to:/i.test(inlineText)) return true;
  return !!(toolUseResult && typeof toolUseResult === 'object' && !Array.isArray(toolUseResult) &&
    typeof toolUseResult.persistedOutputPath === 'string');
}

export function parseDir(dir) {
  const out = [];
  for (const f of iterJsonlFiles(dir)) {
    const s = parseSessionFile(f);
    if (s) out.push(s);
  }
  return out.sort((a, b) => String(a.start).localeCompare(String(b.start)));
}

// Evidence observed in tool-result text. Tool-result text is self-reported by
// whatever ran inside the session; it is not independently verified output.
const TEST_LINE = /([1-9]\d*)\s+(?:tests?\s+)?(?:passing|passed)\b/i;
const FAIL_LINE = /([1-9]\d*)\s+(?:tests?\s+)?(?:failing|failed)\b/i;
const EXIT_ZERO = /(?:exit code|exit status)[:=]?\s*0\b/i;
const EXIT_NONZERO = /(?:exit code|exit status)[:=]?\s*([1-9]\d*)\b/;

function lastMatch(re, text) {
  const flags = re.flags.includes('g') ? re.flags : re.flags + 'g';
  const global = new RegExp(re.source, flags);
  let m, last = null;
  while ((m = global.exec(text))) last = m;
  return last;
}

function collectEvidence(text, out) {
  if (!text) return;
  let m;
  // Full spill text can contain several suite summaries. Keep the last observed
  // count rather than the first, while failure evidence still wins downstream.
  if ((m = lastMatch(FAIL_LINE, text))) out.push({ kind: 'test-failure', detail: `${m[1]} failing (log-reported)` });
  if ((m = lastMatch(EXIT_NONZERO, text))) out.push({ kind: 'exit-nonzero', detail: `exit code ${m[1]} (log-reported)` });
  if ((m = lastMatch(TEST_LINE, text))) out.push({ kind: 'test-pass', detail: `${m[1]} passing (log-reported)` });
  else if (EXIT_ZERO.test(text)) out.push({ kind: 'command-exited-0', detail: 'a command exited 0 (log-reported; says nothing about task success)' });
}
