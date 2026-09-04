const UUID_REGEX =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export interface ManifestUrlParts {
  baseUrl: string;
  uuid: string;
  encryptedPassword?: string;
  /** Stands in for uuid and password when the profile has one. */
  alias?: string | null;
  /** Variant ids for this addon. Empty is the base config. */
  variantIds?: string[];
  /** Only the install card offers the query form; linked accounts never use it. */
  location?: 'path' | 'query';
}

export function buildManifestUrl({
  baseUrl,
  uuid,
  encryptedPassword,
  alias,
  variantIds = [],
  location = 'path',
}: ManifestUrlParts): string {
  if (!uuid) return '';
  const identity = alias ?? (UUID_REGEX.test(uuid) ? null : uuid) ?? null;
  const prefix = identity
    ? `${baseUrl}/stremio/u/${identity}`
    : `${baseUrl}/stremio/${uuid}/${encryptedPassword}`;

  const ids = variantIds.map(encodeURIComponent).join(',');
  const path = ids && location === 'path' ? `/v/${ids}` : '';
  const query = ids && location === 'query' ? `?v=${ids}` : '';
  return `${prefix}${path}/manifest.json${query}`;
}

function splitVariantIds(raw: string): string[] {
  return raw
    .split(',')
    .map((id) => decodeURIComponent(id).trim())
    .filter(Boolean);
}

/**
 * The variant selection named by the URL currently open, in whichever form it
 * uses.
 *
 * The path form wins when both appear.
 */
export function variantSelectionFromLocation(
  pathname: string,
  search: string
): { ids: string[]; location: 'path' | 'query' } | null {
  const path = /\/v\/([^/]+)\/configure\/?$/.exec(pathname);
  if (path) {
    const ids = splitVariantIds(path[1]);
    if (ids.length) return { ids, location: 'path' };
  }

  let raw: string | null = null;
  try {
    raw = new URLSearchParams(search).get('v');
  } catch {
    raw = null;
  }
  if (raw) {
    const ids = splitVariantIds(raw);
    if (ids.length) return { ids, location: 'query' };
  }
  return null;
}

/** Recovers the variant selection from a URL so the editor can render it. */
export function parseVariantIds(url: string): string[] {
  const path = /\/v\/([^/?]+)/.exec(url);
  const query = /[?&]v=([^&]+)/.exec(url);
  const raw = path?.[1] ?? query?.[1];
  return raw ? splitVariantIds(raw) : [];
}
