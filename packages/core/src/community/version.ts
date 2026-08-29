export const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;

function parts(version: string): number[] {
  return version.split('.').map((part) => Number(part) || 0);
}

/** Numeric three-part compare: negative when a < b, positive when a > b. */
export function compareVersions(a: string, b: string): number {
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function bumpPatch(version: string): string {
  const [major = 1, minor = 0, patch = 0] = parts(version);
  return `${major}.${minor}.${patch + 1}`;
}
