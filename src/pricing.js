// Cost ESTIMATION from published API list prices. This is not billed spend.
// Source: https://docs.claude.com/en/docs/about-claude/pricing (fetched 2026-11-03).
// USD per million tokens: standard input, 5-minute cache write, cache read, output.
// Not modeled: 1h cache writes, long-context or fast-mode premiums, batch discounts,
// regional pricing, subscription plans (no per-token billing). Models not listed
// here get unknown cost; there is no fallback rate.
export const PRICING_SOURCE = {
  url: 'https://docs.claude.com/en/docs/about-claude/pricing',
  asOf: '2026-11-03',
};
export const MODEL_PRICING = {
  'claude-opus-4-1':   { input: 15, cacheWrite: 18.75, cacheRead: 1.5, output: 75 },
  'claude-opus-4-0':   { input: 15, cacheWrite: 18.75, cacheRead: 1.5, output: 75 },
  'claude-opus-4-5':   { input: 5,  cacheWrite: 6.25,  cacheRead: 0.5, output: 25 },
  'claude-opus-4-6':   { input: 5,  cacheWrite: 6.25,  cacheRead: 0.5, output: 25 },
  'claude-opus-4-7':   { input: 5,  cacheWrite: 6.25,  cacheRead: 0.5, output: 25 },
  'claude-opus-4-8':   { input: 5,  cacheWrite: 6.25,  cacheRead: 0.5, output: 25 },
  'claude-opus-5':     { input: 5,  cacheWrite: 6.25,  cacheRead: 0.5, output: 25 },
  'claude-sonnet-4-5': { input: 3,  cacheWrite: 3.75,  cacheRead: 0.3, output: 15 },
  'claude-sonnet-4-6': { input: 3,  cacheWrite: 3.75,  cacheRead: 0.3, output: 15 },
  'claude-sonnet-5':   { input: 2,  cacheWrite: 2.5,   cacheRead: 0.2, output: 10 },
  'claude-haiku-4-5':  { input: 1,  cacheWrite: 1.25,  cacheRead: 0.1, output: 5 },
};

export function pricingFor(model) {
  if (!model) return null;
  const key = Object.keys(MODEL_PRICING).filter(k => model.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  return key ? MODEL_PRICING[key] : null;
}

// 'incomplete-usage' = input/output counts absent in some record (absent is not 0);
// 'unsupported-cache-duration' = 1h cache writes present (rate not modeled).
// status: 'list-price-estimate' | 'unknown-model' | 'no-usage-data'
export function sessionCost(usage) {
  const any = usage && (usage.inputTokens || usage.outputTokens || usage.cacheReadTokens || usage.cacheWriteTokens);
  if (!any) return { usd: null, status: 'no-usage-data' };
  // One rate per session: mixed-model sessions would be mispriced, so they stay unknown.
  if (usage.modelCount > 1) return { usd: null, status: 'mixed-models' };
  const p = pricingFor(usage.model);
  if (!p) return { usd: null, status: 'unknown-model' };
  // Missing fields are not zero: do not guess.
  if (usage.incomplete) return { usd: null, status: 'incomplete-usage' };
  if (usage.cache1h) return { usd: null, status: 'unsupported-cache-duration' };
  const usd = (usage.inputTokens * p.input + usage.outputTokens * p.output +
               usage.cacheReadTokens * p.cacheRead + usage.cacheWriteTokens * p.cacheWrite) / 1e6;
  return { usd, status: 'list-price-estimate', cacheFieldsMissing: !!usage.cacheFieldsMissing };
}

export const COST_DISCLAIMER =
  `Cost figures are estimates at published API list prices (${PRICING_SOURCE.url}, as of ${PRICING_SOURCE.asOf}), not billed spend. ` +
  'Assumes 5-minute cache writes; long-context, fast-mode, batch, regional and subscription pricing are not modeled. ' +
  'Sessions with a model not in the table show unknown cost. Day totals cover only sessions with a known estimate.';
