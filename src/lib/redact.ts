// Secret masking. Values that must never appear in diffs/UI are replaced with MASK.

export const MASK = "••••••";

const SECRET_KEY_RE = /(key|token|secret|passw|credential|auth)/i;
const SECRET_VALUE_RE = /^(sk-|ghp_|github_pat_|glpat-|xox[a-z]-|AKIA|AIza|Bearer )/;

export function looksLikeSecret(key: string, value: string): boolean {
  if (SECRET_KEY_RE.test(key)) return true;
  if (SECRET_VALUE_RE.test(value)) return true;
  return value.length > 40 && /^[A-Za-z0-9+/=_-]+$/.test(value);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Replace every occurrence of the given values with MASK (longest first). */
export function maskValues(text: string, values: string[]): string {
  const sorted = [...new Set(values.filter((v) => v.length >= 4))].sort((a, b) => b.length - a.length);
  let out = text;
  for (const value of sorted) {
    out = out.replace(new RegExp(escapeRegExp(value), "g"), MASK);
  }
  return out;
}
