/**
 * Manifest fields that change without changing what the addon can do, so they
 * must not count as a meaningful change. `version` moves on every release and
 * the branding fields are cosmetic; a client does not need reinstalling for
 * any of them.
 */
export const VOLATILE_MANIFEST_FIELDS = [
  'id',
  'version',
  'description',
  'name',
  'logo',
  'behaviorHints',
  'stremioAddonsConfig',
] as const;

export function normaliseManifest<T extends Record<string, any>>(
  manifest: T
): Partial<T> {
  const rest: Record<string, any> = { ...manifest };
  for (const field of VOLATILE_MANIFEST_FIELDS) {
    delete rest[field];
  }
  return rest as Partial<T>;
}

/** Key order varies between serialisations, so it is normalised away too. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(',')}}`;
}

/** FNV-1a. This detects change, it does not defend against anyone. */
function fnv1a(input: string, seed: number): string {
  let hash = seed >>> 0;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function hash(input: string): string {
  return (
    fnv1a(input, 0x811c9dc5) +
    fnv1a(input, 0x1000193) +
    fnv1a(input, 0x9e3779b9) +
    fnv1a(input, 0x85ebca6b)
  );
}

/**
 * Identifies a manifest by what it means to a client. Both sides compare these:
 * the server records one at push time, the configure page computes one for the
 * live manifest, and a mismatch means the linked account is out of date.
 */
export function manifestFingerprint(manifest: unknown): string {
  if (!manifest || typeof manifest !== 'object') return '';
  return hash(
    stableStringify(normaliseManifest(manifest as Record<string, any>))
  );
}

/**
 * Fingerprint of an ordered set, for an account tracking several URLs. A set of
 * one is the fingerprint of that one, so the configure page can compare a single
 * manifest against it without knowing it came from a set.
 */
export function manifestSetFingerprint(manifests: unknown[]): string {
  if (manifests.length === 0) return '';
  if (manifests.length === 1) return manifestFingerprint(manifests[0]);
  return hash(manifests.map(manifestFingerprint).join('|'));
}
