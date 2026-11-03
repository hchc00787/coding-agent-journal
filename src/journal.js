import { sessionCost } from './pricing.js';
import { redactSecrets, redactPaths, bounded } from './redact.js';

// Outcome honesty:
//  - 'log-reported-failure' / 'log-reported-pass': signals found in tool-result
//    text recorded in the log. That text is self-reported by whatever ran in
//    the session; it is NOT independently rerun or verified by this tool.
//  - 'agent-claimed-only': the last agent message explicitly states completion
//    (questions and plans do not count), with nothing corroborating it.
//  - 'unknown': no outcome signal at all.
// A failure signal always wins over pass signals and agent claims.
// An exit code of 0 is labeled as exactly that (a command exited 0), never
// as "task completed".
// An agent message counts as an outcome claim only if it states completion.
// Questions, plans ("I'll ..."), and status chatter stay unknown.
// Only clear first-person or sentence-initial completion assertions count.
const CLAIM_PATTERNS = [
  /^\s*(?:all )?(?:done|fixed|completed?|finished|implemented|resolved)\b/i,
  /\b(?:i|we)(?:'ve| have)?\s+(?:now\s+)?(?:fixed|completed|finished|implemented|resolved)\b/i,
  /\ball (?:fixed|done|set)\b/i,
  /\ball (?:the )?tests? (?:now )?pass(?:ed|ing)?\b/i,
  /\btests? (?:now )?pass(?:ed|ing)?\b/i,
  /\bis now (?:working|in place|fixed)\b/i,
];
const QUOTED_OR_DESCRIPTIVE = /["'`\u201c\u201d]|\b(?:word|found|source|string|text|mentions?|quote[ds]?|says?|called|named|log|output)\b/i;
// Conservative: any negation, hedge, condition or future/plan wording anywhere
// in the message disqualifies it as a completion claim.
const DISQUALIFY = /\b(not|never|no|nothing|none|yet|still|unable|cannot|unfinished|incomplete|partial(?:ly)?|failed|failing|fails?|if|unless|until|once|should|would|could|might|may|will|plan|todo|next|need(?:s)? to|remaining|left to)\b|n't|\u2019t/i;
const NOT_CLAIM = /^\s*(?:i'?ll|i will|let me|i am going to|i'm going to|going to|next,? i)\b/i;
export function isExplicitClaim(text) {
  if (typeof text !== 'string' || !text) return false;
  const t = text.trim();
  if (t.endsWith('?') || NOT_CLAIM.test(t) || DISQUALIFY.test(t)) return false;
  if (QUOTED_OR_DESCRIPTIVE.test(t)) return false;
  return CLAIM_PATTERNS.some(re => re.test(t));
}

export function toJournalEntry(session, { fullText = false } = {}) {
  const cost = sessionCost(session.usage);
  const failures = session.evidence.filter(e => e.kind === 'test-failure' || e.kind === 'exit-nonzero');
  const passes = session.evidence.filter(e => e.kind === 'test-pass');
  const exit0 = session.evidence.filter(e => e.kind === 'command-exited-0');

  let outcome;
  if (failures.length) {
    outcome = { status: 'log-reported-failure', basis: 'log', detail: failures.map(e => e.detail).join('; ') };
  } else if (passes.length) {
    outcome = { status: 'log-reported-pass', basis: 'log', detail: passes.map(e => e.detail).join('; ') };
  } else if (isExplicitClaim(session.lastAssistantText)) {
    outcome = { status: 'agent-claimed-only', basis: 'claimed', detail: 'Last agent message states completion; no corroborating signal in the log.' };
  } else {
    outcome = { status: 'unknown', basis: 'unknown',
      detail: exit0.length ? `No outcome signal. ${exit0.length} command(s) exited 0 (log-reported); that is not a task result.` : 'No outcome signal recorded.' };
  }

  const task = session.firstUserText
    ? bounded(redactPaths(redactSecrets(session.firstUserText), session.cwd), fullText ? 2000 : 200)
    : '(no task text captured)';

  return {
    sessionId: session.id,
    project: session.project,
    date: String(session.start || '').slice(0, 10),
    start: session.start, end: session.end,
    models: [...session.models],
    tokens: { incomplete: !!session.usage.incomplete, inputTokens: session.usage.inputTokens, outputTokens: session.usage.outputTokens,
              cacheReadTokens: session.usage.cacheReadTokens, cacheWriteTokens: session.usage.cacheWriteTokens },
    cost, // { usd, status } - status 'list-price-estimate' is NOT actual cost
    task,
    filesModified: [...session.filesModified].map(f => redactPaths(f, session.cwd)),
    filesRead: [...session.filesRead].map(f => redactPaths(f, session.cwd)),
    toolCalls: session.toolCalls,
    outcome,
    skippedMalformed: session.skippedMalformed, skippedDuplicate: session.skippedDuplicate,
  };
}

export function buildJournal(sessions, opts) {
  const entries = sessions.map(s => toJournalEntry(s, opts));
  const byDay = new Map();
  for (const e of entries) {
    if (!byDay.has(e.date)) byDay.set(e.date, []);
    byDay.get(e.date).push(e);
  }
  return { generatedAt: new Date().toISOString(), days: [...byDay.entries()].map(([date, items]) => ({
    date,
    entries: items,
    knownCostUsd: Math.round(items.reduce((a, b) => a + (b.cost.usd || 0), 0) * 100) / 100,
    anyCostUnknown: items.some(e => e.cost.status !== 'list-price-estimate'),
    totalTokens: items.reduce((a, b) => a + b.tokens.inputTokens + b.tokens.outputTokens, 0),
  })) };
}
