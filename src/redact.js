const SECRET_PATTERNS = [
  /(?:sk|pk|api|key|token|secret|password)[-_]?[A-Za-z0-9]{8,}/gi,
  /sk-[A-Za-z0-9_-]{8,}/g,
  /ghp_[A-Za-z0-9]{20,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

export function redactSecrets(text) {
  let out = String(text ?? '');
  for (const re of SECRET_PATTERNS) out = out.replace(re, '[REDACTED]');
  return out.replace(/(\[REDACTED\])+/g, '[REDACTED]');
}

export function redactPaths(text, projectRoot) {
  let out = String(text ?? '');
  if (projectRoot) out = out.split(projectRoot).join('<project>');
  out = out.replace(/\/home\/[A-Za-z0-9._-]+/g, '~').replace(/\/Users\/[A-Za-z0-9._-]+/g, '~');
  return out;
}

export function bounded(text, max = 200) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}
