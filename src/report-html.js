import { COST_DISCLAIMER } from './pricing.js';
import { outcomeLabel, costLabel, spillLabel, COVERAGE_LIMITS, GENERATED_MARK } from './report-md.js';

function esc(s) { return String(s).replace(/[&<>"'`]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c])); }

const EVIDENCE_CAVEAT =
  '"Log-reported" means the signal appeared in tool-output text recorded in the session log. ' +
  'That text is self-reported by whatever ran in the session; this tool did not rerun or verify it.';

export function renderHtml(journal) {
  const days = journal.days.map(day => `
    <section><h2>${esc(day.date)} <small>~$${day.knownCostUsd.toFixed(2)} list-price est.${day.anyCostUnknown ? ' (partial: some unknown)' : ''}</small></h2>
    ${day.entries.map(e => `
      <article class="entry">
        <h3>${esc(e.project)} <small>${esc(e.models.join(', ') || 'unknown model')} · ${esc(costLabel(e.cost))}</small></h3>
        <p class="task">${esc(e.task)}</p>
        <p class="meta">in ${Number(e.tokens.inputTokens)} / out ${Number(e.tokens.outputTokens)} / cache read ${Number(e.tokens.cacheReadTokens)} / cache write ${Number(e.tokens.cacheWriteTokens)} tokens${e.tokens.incomplete ? ' (partial: some usage missing or invalid)' : ''} · ${Number(e.filesModified.length)} modified / ${Number(e.filesRead.length)} read files${spillLabel(e.spill) ? ` · spills: ${esc(spillLabel(e.spill))}` : ''} · <b class="badge ${e.outcome.status==='log-reported-failure'?'fail':e.outcome.status==='log-reported-pass'?'pass':e.outcome.basis}">${esc(outcomeLabel(e.outcome.status))}</b> - ${esc(e.outcome.detail)}</p>
      </article>`).join('')}
    </section>`).join('');
  return `<!doctype html>
${GENERATED_MARK}
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Agent work journal</title><style>
body{font-family:system-ui,sans-serif;font-size:18px;line-height:1.5;max-width:720px;margin:1.5rem auto;padding:0 1rem;color:#251f21}
h1{font-size:1.6rem}h3{font-size:1.1rem;margin-bottom:.2rem}h3 small{display:block}
h2{border-bottom:1px solid #eae9ea;padding-bottom:.3rem}small{color:#585254;font-weight:400}
.entry{margin:1rem 0}.task{margin:.2rem 0;white-space:pre-wrap;overflow-wrap:anywhere}.meta{font-size:.95rem;overflow-wrap:anywhere;color:#585254}
.badge{font-weight:700}.pass{color:#585254}.fail{color:#b3261e}.claimed{color:#9a6a00}.unknown{color:#585254}
footer{margin-top:2rem;font-size:.8rem;color:#585254}
</style></head><body><h1>Agent work journal</h1>${days}
<footer><p>${esc(EVIDENCE_CAVEAT)}</p><p>${esc(COST_DISCLAIMER)}</p><p>${esc(COVERAGE_LIMITS)}</p>
<p>Generated ${esc(journal.generatedAt)}. Local-only; review before sharing. Redaction is heuristic and not comprehensive.</p></footer></body></html>`;
}
