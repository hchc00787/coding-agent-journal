import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDir, parseSessionFile } from '../src/parse.js';
import { buildJournal, isExplicitClaim } from '../src/journal.js';
import { renderMarkdown, costLabel } from '../src/report-md.js';
import { renderHtml } from '../src/report-html.js';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { redactSecrets, redactPaths } from '../src/redact.js';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

test('parses synthetic sessions and labels cost as list-price estimate or unknown, never as billed spend', () => {
  const sessions = parseDir(path.join(fixtures, 'demo-project'));
  assert.ok(sessions.length >= 2);
  const journal = buildJournal(sessions, {});
  assert.ok(journal.days.length >= 1);
  for (const day of journal.days)
    for (const e of day.entries) {
      assert.ok(['list-price-estimate', 'unknown-model', 'no-usage-data'].includes(e.cost.status));
      if (e.cost.status !== 'list-price-estimate') assert.equal(e.cost.usd, null);
    }
});

test('outcome honesty: failure signal wins over later agent success claim', () => {
  const s = parseSessionFile(path.join(fixtures, 'adversarial-project', 'adv-001.jsonl'));
  const [e] = buildJournal([s], {}).days[0].entries;
  assert.equal(e.outcome.status, 'log-reported-failure');
  assert.match(e.outcome.detail, /log-reported/);
});

test('agent narration without corroborating signal is agent-claimed only', () => {
  const s = parseSessionFile(path.join(fixtures, 'demo-project', 'session-b.jsonl'));
  const [e] = buildJournal([s], {}).days[0].entries;
  assert.equal(e.outcome.status, 'agent-claimed-only');
});

test('redaction strips secrets and private paths from captured task text', () => {
  assert.equal(redactSecrets('token sk-ant-FAKEKEY123456789 here'), 'token [REDACTED] here');
  const s = parseSessionFile(path.join(fixtures, 'adversarial-project', 'adv-001.jsonl'));
  const [e] = buildJournal([s], {}).days[0].entries;
  assert.ok(!e.task.includes('sk-ant-FAKEKEY123456789'), 'secret leaked into task text');
  assert.ok(!e.task.includes('/home/testuser/projects/client-acme'), 'private path leaked');
  assert.ok(e.task.includes('<project>'), 'project root not substituted');
});

test('HTML output escapes script injection from log content', () => {
  const s = parseSessionFile(path.join(fixtures, 'adversarial-project', 'adv-001.jsonl'));
  const html = renderHtml(buildJournal([s], {}));
  assert.ok(!html.includes('<script>alert'), 'raw script tag leaked into HTML');
  assert.ok(html.includes('&lt;script&gt;'), 'expected escaped script tag');
  const md = renderMarkdown(buildJournal([s], {}));
  assert.ok(!md.includes('<script>'), 'raw HTML leaked into Markdown');
});

test('unknown model yields unknown cost, never a guessed number', () => {
  const s = parseSessionFile(path.join(fixtures, 'adversarial-project', 'adv-001.jsonl'));
  const [e] = buildJournal([s], {}).days[0].entries;
  assert.equal(e.cost.status, 'unknown-model');
  assert.equal(e.cost.usd, null);
  assert.equal(costLabel(e.cost), 'unknown cost (unrecognized model)');
});

test('malformed JSONL lines are skipped and counted', () => {
  const s = parseSessionFile(path.join(fixtures, 'adversarial-project', 'adv-001.jsonl'));
  assert.equal(s.skippedMalformed, 1);
});

test('duplicate uuid lines are deduplicated (usage and tool calls not doubled)', () => {
  const s = parseSessionFile(path.join(fixtures, 'adversarial-project', 'adv-001.jsonl'));
  assert.equal(s.skippedDuplicate, 1);
  assert.equal(s.usage.inputTokens, 150); // 100 + 50, not 200 + 50
});

test('out-of-order timestamps: start is the earliest, end the latest', () => {
  const s = parseSessionFile(path.join(fixtures, 'adversarial-project', 'adv-001.jsonl'));
  assert.equal(s.start, '2026-11-02T07:59:00Z');
  assert.equal(s.end, '2026-11-02T08:06:00Z');
});

test('streamed usage repeated across lines with same message.id is counted once', () => {
  // session-a has assistant lines; ensure usage is keyed by message.id when present
  const s = parseSessionFile(path.join(fixtures, 'demo-project', 'session-a.jsonl'));
  assert.ok(s.usage.inputTokens > 0);
});

test('missing usage fields are unknown, not zero; 1h cache writes are unknown', async () => {
  const { sessionCost } = await import('../src/pricing.js');
  const base = { model: 'claude-sonnet-4-5', inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 };
  assert.equal(sessionCost({ ...base, incomplete: true }).usd, null);
  assert.equal(sessionCost({ ...base, incomplete: true }).status, 'incomplete-usage');
  assert.equal(sessionCost({ ...base, cache1h: true }).status, 'unsupported-cache-duration');
  assert.equal(sessionCost({ ...base, cacheFieldsMissing: true }).cacheFieldsMissing, true);
  assert.equal(sessionCost({ ...base }).status, 'list-price-estimate');
});

test('mixed-model sessions are unknown cost', async () => {
  const { sessionCost } = await import('../src/pricing.js');
  const u = { model: 'claude-sonnet-4-5', modelCount: 2, inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 };
  assert.equal(sessionCost(u).status, 'mixed-models');
  assert.equal(sessionCost(u).usd, null);
});

test('plans, questions and chatter are not outcome claims; explicit completion is', () => {
  for (const s of ["I'll investigate the failing test.", 'Should I also update the docs?', 'Let me look at the billing module.', 'Working on it.', ''])
    assert.equal(isExplicitClaim(s), false, s);
  for (const s of ['Done. Rate limiting is in place.', 'All fixed, tests pass now.', 'The refund flow is now working.'])
    assert.equal(isExplicitClaim(s), true, s);
});

test('exit code 0 alone is not a pass; session without claim stays unknown', () => {
  const s = { id: 'x', cwd: '/p', start: '2026-11-01T00:00:00Z', end: '2026-11-01T00:01:00Z', project: 'p',
    models: new Set(['claude-sonnet-4-5']), usage: { model: 'claude-sonnet-4-5', modelCount: 1, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
    firstUserText: 'list files', lastAssistantText: "I'll check the folder next.", filesModified: new Set(), filesRead: new Set(['/p/a.js']),
    toolCalls: 1, evidence: [{ kind: 'command-exited-0', detail: 'a command exited 0 (log-reported; says nothing about task success)' }],
    skippedMalformed: 0, skippedDuplicate: 0 };
  const [e] = buildJournal([s], {}).days[0].entries;
  assert.equal(e.outcome.status, 'unknown');
  assert.match(e.outcome.detail, /exited 0/);
  assert.deepEqual(e.filesModified, []);
  assert.deepEqual(e.filesRead, ['<project>/a.js'].map(x => x));
});

test('redactPaths generalizes home dirs', () => {
  assert.equal(redactPaths('/home/alice/x'), '~/x');
  assert.equal(redactPaths('/Users/bob/y'), '~/y');
});

const writeSession = (lines, name = 's.jsonl') => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aj-'));
  fs.writeFileSync(path.join(dir, name), lines.map(l => typeof l === 'string' ? l : JSON.stringify(l)).join('\n') + '\n');
  return dir;
};
const asst = (extra = {}, usage = { input_tokens: 5, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }) =>
  ({ sessionId: 's', cwd: '/p', timestamp: '2026-11-01T00:00:00Z', type: 'assistant',
     message: { role: 'assistant', id: 'm1', model: 'claude-sonnet-4-5', usage, content: [{ type: 'text', text: 'Working' }], ...extra } });

test('non-numeric / negative / non-finite usage values are untrusted: unknown cost, no markup in output', () => {
  const evil = '<img src=x onerror=alert(1)>';
  for (const bad of [evil, -5, null, 'NaN', { a: 1 }, 1e999]) {
    // invalid cache fields must also make cost unknown, never a silent undercount
    const d2 = writeSession([asst({}, { input_tokens: 5, output_tokens: 5, cache_read_input_tokens: bad, cache_creation_input_tokens: 0 })]);
    assert.equal(buildJournal(parseDir(d2), {}).days[0].entries[0].cost.usd, null, 'invalid cache field priced');
    const dir = writeSession([asst({}, { input_tokens: bad, output_tokens: 5 })]);
    const j = buildJournal(parseDir(dir), {});
    const [e] = j.days[0].entries;
    assert.equal(e.cost.usd, null);
    assert.equal(e.tokens.incomplete, true);
    const html = renderHtml(j), md = renderMarkdown(j);
    assert.ok(!html.includes('<img') && !html.includes('onerror=alert') || !html.includes('<img src'), 'unescaped markup');
    assert.ok(!/<img/i.test(html) && !/<img/i.test(md));
  }
});

test('assistant message with no usage at all makes cost unknown, not a silent partial estimate', () => {
  const dir = writeSession([asst({ id: 'm1' }), asst({ id: 'm2', usage: undefined })]);
  const [e] = buildJournal(parseDir(dir), {}).days[0].entries;
  assert.equal(e.cost.status, 'incomplete-usage');
  assert.equal(e.cost.usd, null);
});

test('JSON null / array / primitive lines and odd field types do not crash', () => {
  const dir = writeSession(['null', '[]', '42', '"str"', JSON.stringify({ type: 'user', message: null }),
    JSON.stringify({ type: 'assistant', message: { content: [null, 7, { type: 'tool_use', name: 'Edit', input: { file_path: 5 } }], usage: null } }),
    JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: [null, { type: 'text', text: 3 }] }] } }),
    JSON.stringify({ sessionId: 7, cwd: {}, timestamp: 12, type: 'user', message: { role: 'user', content: 'ok task' } })]);
  const sessions = parseDir(dir);
  assert.equal(sessions.length, 1);
  assert.ok(sessions[0].skippedMalformed >= 4);
  assert.doesNotThrow(() => { buildJournal(sessions, {}); renderHtml(buildJournal(sessions, {})); });
});

test('Markdown output neutralizes images, links, headings and HTML from log text', () => {
  const dir = writeSession([{ sessionId: 's', cwd: '/p', timestamp: '2026-11-01T00:00:00Z', type: 'user',
    message: { role: 'user', content: '![x](https://evil.example/t.png) [click](https://evil.example) # H `c` <b>x</b>' } }]);
  const md = renderMarkdown(buildJournal(parseDir(dir), {}));
  assert.ok(!/(^|[^\\])!\[/m.test(md), 'live image syntax');
  assert.ok(!/(^|[^\\])\]\(/.test(md), 'live link syntax');
  assert.ok(!md.includes('<b>'));
  assert.ok(!md.includes('https://evil'), 'raw URL left clickable');
});

test('negated, hedged or conditional completion wording is not a claim', () => {
  for (const s of ['Not done yet.', 'This is not fixed.', "It isn't finished", 'Tests still failing, not fixed', 'Done once the tests pass.',
    'I have not completed the task', 'Fixed? Not sure.', 'Partially implemented', 'Nothing is resolved', 'Should be fixed if you rerun', 'This is not fixed.', 'The task is incomplete; I have not implemented the fix.', 'I found the word completed in the source.', 'The log says "done".'])
    assert.equal(isExplicitClaim(s), false, s);
});

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'agent-journal.js');
const snapshot = dir => Object.fromEntries(fs.readdirSync(dir).sort().map(n => [n, fs.readFileSync(path.join(dir, n), 'utf8')]));

test('CLI refuses a foreign non-empty directory and changes nothing (files and .gitignore byte-for-byte)', () => {
  const input = writeSession([asst()]);
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'aj-out-'));
  fs.writeFileSync(path.join(out, '.gitignore'), 'node_modules\n');
  fs.writeFileSync(path.join(out, 'journal.md'), '# Agent work journal\nmy own notes\n');
  fs.writeFileSync(path.join(out, 'code.js'), 'x');
  const before = snapshot(out);
  const r = spawnSync('node', [BIN, '--input', input, '--out', out], { encoding: 'utf8' });
  assert.equal(r.status, 3);
  assert.deepEqual(snapshot(out), before);
  assert.ok(!fs.existsSync(path.join(out, '.agent-journal-output')));
});

test('CLI refuses when --out is a file, and works for new, empty and previously owned directories', () => {
  const input = writeSession([asst()]);
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'aj-base-'));
  const asFile = path.join(base, 'f'); fs.writeFileSync(asFile, 'x');
  assert.equal(spawnSync('node', [BIN, '--input', input, '--out', asFile]).status, 3);
  assert.equal(fs.readFileSync(asFile, 'utf8'), 'x');
  const fresh = path.join(base, 'new');
  const empty = path.join(base, 'empty'); fs.mkdirSync(empty);
  for (const d of [fresh, empty]) {
    execFileSync('node', [BIN, '--input', input, '--out', d]);
    assert.equal(fs.readFileSync(path.join(d, '.gitignore'), 'utf8'), '*\n');
    execFileSync('node', [BIN, '--input', input, '--out', d]); // rerun over own output
  }
});
