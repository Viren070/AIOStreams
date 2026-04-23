// Stremio catalog meta IDs are strings (e.g. "tt1234567", "kitsu:1234", "tmdb:5678"),
// but Seanime's custom-source local ID space is a 40-bit integer.
//
// Encoding layout (40 bits):
//   bits 39-32  combined tag  =  schemeTag * META_TYPE_COUNT + metaTypeTag
//   bits 31-0   numeric ID value
//
// schemeTag (1-based, never 0) × META_TYPE_COUNT (4) gives a minimum combined
// tag of 4, so the minimum encoded value is 4 × 2^32 = 17 179 869 184.
// FNV-1a 32-bit hashes used for unknown IDs top out at 2^32 − 1 = 4 294 967 295,
// so the two ranges are completely disjoint — no collision is possible.
//
// Seanime wraps the local id as `2^31 + (extensionIdentifier << 40) + localId`
// before handing it to plugins; call `unwrapSeanimeMediaId` to recover the raw
// local id.

export type StremioMetaType = 'movie' | 'series' | 'tv' | 'channel';

export type StremioIdKind =
  | 'imdbId'
  | 'kitsuId'
  | 'malId'
  | 'anilistId'
  | 'themoviedbId'
  | 'thetvdbId'
  | 'anidbId'
  | 'simklId';

type StremioIdScheme = {
  tag: number;
  prefix: string;
  kind: StremioIdKind;
  format: (value: number) => string;
};

// Scheme tags must stay stable — changing them rewrites every existing local ID.
const SCHEMES: StremioIdScheme[] = [
  {
    tag: 1,
    prefix: 'tt',
    kind: 'imdbId',
    format: (v) => `tt${String(v).padStart(7, '0')}`,
  },
  { tag: 2, prefix: 'kitsu:', kind: 'kitsuId', format: (v) => `kitsu:${v}` },
  { tag: 3, prefix: 'mal:', kind: 'malId', format: (v) => `mal:${v}` },
  {
    tag: 4,
    prefix: 'anilist:',
    kind: 'anilistId',
    format: (v) => `anilist:${v}`,
  },
  {
    tag: 5,
    prefix: 'tmdb:',
    kind: 'themoviedbId',
    format: (v) => `tmdb:${v}`,
  },
  { tag: 6, prefix: 'tvdb:', kind: 'thetvdbId', format: (v) => `tvdb:${v}` },
  { tag: 7, prefix: 'anidb:', kind: 'anidbId', format: (v) => `anidb:${v}` },
  { tag: 8, prefix: 'simkl:', kind: 'simklId', format: (v) => `simkl:${v}` },
];

// Meta type tags must stay stable.
const META_TYPES: StremioMetaType[] = ['movie', 'series', 'tv', 'channel'];
const META_TYPE_COUNT = META_TYPES.length; // 4 — consumes 2 bits of the combined tag

const SCHEMES_BY_TAG: Record<number, StremioIdScheme> = {};
for (const s of SCHEMES) SCHEMES_BY_TAG[s.tag] = s;

const VALUE_MASK = 0xffffffff; // 2^32 - 1
const VALUE_BITS = 0x100000000; // 2^32

// Seanime wraps custom-source local IDs as `2^31 + (extensionIdentifier << 40) + localId`.
const EXTENSION_ID_OFFSET = 0x80000000; // 2^31
const LOCAL_ID_MODULO = 0x10000000000; // 2^40

export function unwrapSeanimeMediaId(id: number): number {
  if (!Number.isFinite(id) || id < EXTENSION_ID_OFFSET) return id;
  return (id - EXTENSION_ID_OFFSET) % LOCAL_ID_MODULO;
}

function parsePrefix(id: string): { scheme: StremioIdScheme; value: number } {
  for (const scheme of SCHEMES) {
    if (!id.startsWith(scheme.prefix)) continue;
    const numeric = id.slice(scheme.prefix.length);
    if (!/^\d+$/.test(numeric)) continue;
    const value = Number(numeric);
    if (!Number.isFinite(value) || value < 0 || value > VALUE_MASK) continue;
    return { scheme, value };
  }
  throw new Error(`Unsupported Stremio ID format: ${id}`);
}

export function canEncodeStremioId(id: string): boolean {
  try {
    parsePrefix(id);
    return true;
  } catch {
    return false;
  }
}

export function encodeStremioId(id: string, metaType: string): number {
  const { scheme, value } = parsePrefix(id);
  const typeTag = META_TYPES.indexOf(metaType as StremioMetaType);
  const safeTypeTag = typeTag >= 0 ? typeTag : 0;
  const combinedTag = scheme.tag * META_TYPE_COUNT + safeTypeTag;
  return combinedTag * VALUE_BITS + value;
}

export interface DecodedStremioLocalId {
  stremioId: string;
  metaType: StremioMetaType;
  kind: StremioIdKind;
  /** ParsedId-compatible value: full `tt…` for IMDb, bare number otherwise */
  value: string;
}

export function parseStremioId(stremioId: string): {
  season?: number;
  episode?: number;
  baseId: string;
} {
  const prefixedSchemes = [
    'kitsu:',
    'mal:',
    'anilist:',
    'tmdb:',
    'tvdb:',
    'anidb:',
    'simkl:',
  ];

  const colonIdx = stremioId.indexOf(':');
  if (colonIdx === -1) return { baseId: stremioId };

  if (/^tt\d+/.test(stremioId)) {
    const baseId = stremioId.slice(0, colonIdx);
    const rest = stremioId
      .slice(colonIdx + 1)
      .split(':')
      .map(Number);
    if (rest.length === 1 && Number.isFinite(rest[0]))
      return { baseId, episode: rest[0] };
    if (
      rest.length >= 2 &&
      Number.isFinite(rest[0]) &&
      Number.isFinite(rest[1])
    )
      return { baseId, season: rest[0], episode: rest[1] };
    return { baseId };
  }

  const scheme = prefixedSchemes.find((s) => stremioId.startsWith(s));
  if (scheme) {
    const afterScheme = stremioId.slice(scheme.length);
    const parts = afterScheme.split(':');
    const baseId = `${scheme}${parts[0]}`;
    const rest = parts.slice(1).map(Number);
    if (rest.length === 0) return { baseId };
    if (rest.length === 1 && Number.isFinite(rest[0]))
      return { baseId, episode: rest[0] };
    if (
      rest.length >= 2 &&
      Number.isFinite(rest[0]) &&
      Number.isFinite(rest[1])
    )
      return { baseId, season: rest[0], episode: rest[1] };
    return { baseId };
  }

  const parts = stremioId.split(':');
  const nums: number[] = [];
  for (let i = parts.length - 1; i >= 0; i--) {
    const n = Number(parts[i]);
    if (!Number.isFinite(n)) break;
    nums.unshift(n);
  }
  if (nums.length === 0) return { baseId: stremioId };
  if (nums.length === 1)
    return { episode: nums[0], baseId: parts.slice(0, -1).join(':') };
  return {
    season: nums[nums.length - 2],
    episode: nums[nums.length - 1],
    baseId: parts.slice(0, -2).join(':'),
  };
}

export function tryDecodeStremioLocalId(
  localId: number
): DecodedStremioLocalId | null {
  if (!Number.isFinite(localId) || localId < 0) return null;
  const combinedTag = Math.floor(localId / VALUE_BITS);
  const numericValue = localId % VALUE_BITS;
  const schemeTag = Math.floor(combinedTag / META_TYPE_COUNT);
  const typeTag = combinedTag % META_TYPE_COUNT;
  const scheme = SCHEMES_BY_TAG[schemeTag];
  if (!scheme) return null;
  const stremioId = scheme.format(numericValue);
  const metaType = META_TYPES[typeTag] ?? 'movie';
  return {
    stremioId,
    metaType,
    kind: scheme.kind,
    value: scheme.kind === 'imdbId' ? stremioId : String(numericValue),
  };
}
