import { COST_DISCLAIMER } from './pricing.js';

const OUTCOME_LABEL = {
  'log-reported-pass': 'log-reported pass',
  'log-reported-failure': 'log-reported failure',
  'agent-claimed-only': 'agent-claimed only',
  'unknown': 'unknown',
};

export const GENERATED_MARK = '<!-- generated-by: coding-agent-journal -->';

export const COVERAGE_LIMITS =
  'Coverage limits: parsed from third-party documented Claude Code JSONL format, untested against real logs. Standard text tool-result spill files are read when found, with missing, truncated or unsupported spills labeled; structured JSON spills, Codex logs and file-history snapshots are not read. Sidechain events inside a file are included in the session for that file, while separate subagent files appear as separate entries. Missing usage fields are treated as unknown, not zero.';

export function outcomeLabel(status) { return OUTCOME_LABEL[status] || status; }

export function costLabel(cost) {
  if (cost.status === 'list-price-estimate') return `~$${cost.usd.toFixed(2)} (list-price est.${cost.cacheFieldsMissing ? '; cache fields not reported' : ''})`;
  if (cost.status === 'unknown-model') return 'unknown cost (unrecognized model)';
  if (cost.status === 'mixed-models') return 'unknown cost (multiple models in one session; per-message pricing not implemented)';
  if (cost.status === 'incomplete-usage') return 'unknown cost (usage fields missing in log)';
  if (cost.status === 'unsupported-cache-duration') return 'unknown cost (1h cache writes not modeled)';
  return 'unknown cost (no usage data)';
}

// Escape characters that break Markdown tables or render as raw HTML.
// Log-derived text is untrusted: neutralize HTML, Markdown links/images/emphasis/code,
// headings and tables so nothing renders or fetches when the file is previewed.
function md(s) {
  return String(s).replace(/[\r\n]+/g, ' ')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/[\\`*_{}\[\]()#+!|~]/g, c => '\\' + c)
    .replace(/:\/\//g, ':&#8203;//');
}
function tok(e) {
  const t = e.tokens;
  return `in ${Number(t.inputTokens)} / out ${Number(t.outputTokens)} / cache read ${Number(t.cacheReadTokens)} / cache write ${Number(t.cacheWriteTokens)}` +
    (t.incomplete ? ' (partial: some messages had missing or invalid usage)' : '');
}

const EVIDENCE_CAVEAT =
  '"Log-reported" means the signal appeared in tool-output text recorded in the session log. ' +
  'That text is self-reported by whatever ran in the session; this tool did not rerun or verify it.';


export function spillLabel(spill) {
  if (!spill || (!spill.read && !spill.missing && !spill.truncated && !spill.unsupported)) return null;
  const parts = [];
  if (spill.read) parts.push(`${spill.read} read`);
  if (spill.truncated) parts.push(`${spill.truncated} truncated (head and tail kept)`);
  if (spill.missing) parts.push(`${spill.missing} missing (inline preview used)`);
  if (spill.unsupported) parts.push(`${spill.unsupported} not read (unsupported structured spill; inline text used)`);
  return parts.join('; ');
}

export function renderMarkdown(journal) {
  const lines = ['# Agent work journal', '', GENERATED_MARK, '',
    `_Generated ${journal.generatedAt}. Local-only; review before sharing._`, '',
    `_${EVIDENCE_CAVEAT}_`, '', `_${COST_DISCLAIMER}_`, '', `_${COVERAGE_LIMITS}_`, ''];
  for (const day of journal.days) {
    const dayCost = day.anyCostUnknown ? `~$${day.knownCostUsd.toFixed(2)} list-price est. (partial: some unknown)` : `~$${day.knownCostUsd.toFixed(2)} list-price est.`;
    lines.push(`## ${day.date} - ${dayCost}`, '');
    for (const e of day.entries) {
      lines.push(`### ${md(e.project)} · ${md(e.models.join(', ') || 'unknown model')} · ${costLabel(e.cost)}`);
      lines.push(`- Task: ${md(e.task)}`);
      lines.push(`- Tokens: ${tok(e)}`);
      if (e.filesModified.length) lines.push(`- Files modified (Edit/Write): ${md(e.filesModified.join(', '))}`);
      if (e.filesRead.length) lines.push(`- Files read: ${md(e.filesRead.join(', '))}`);
      lines.push(`- Outcome: ${OUTCOME_LABEL[e.outcome.status]} - ${md(e.outcome.detail)}`);
      const spill = spillLabel(e.spill);
      if (spill) lines.push(`- Tool output spills: ${md(spill)}`);
      lines.push('');
    }
  }
  return lines.join('\n');
}
