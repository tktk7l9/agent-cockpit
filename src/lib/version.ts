// Pure semver-ish comparison for the manual update check (major.minor.patch only).

export interface Version {
  major: number;
  minor: number;
  patch: number;
}

const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-.+)?$/;

export function parseVersion(tag: string): Version | null {
  const m = VERSION_RE.exec(tag.trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

export function compareVersions(a: string, b: string): -1 | 0 | 1 | null {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  if (!va || !vb) return null;
  if (va.major !== vb.major) return va.major > vb.major ? 1 : -1;
  if (va.minor !== vb.minor) return va.minor > vb.minor ? 1 : -1;
  if (va.patch !== vb.patch) return va.patch > vb.patch ? 1 : -1;
  return 0;
}
