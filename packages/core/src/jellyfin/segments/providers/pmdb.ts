import { appConfig } from '../../../index.js';
import { makeRequest } from '../../../utils/http.js';
import type {
  ProviderContext,
  Segment,
  SegmentLookup,
  SegmentProvider,
  SegmentType,
} from '../types.js';

interface PmdbSkip {
  source?: string | null;
  intro_start_ms?: number | null;
  intro_end_ms?: number | null;
  credits_start_ms?: number | null;
  credits_end_ms?: number | null;
  created?: string | null;
  updated?: string | null;
}

interface PmdbSkipsResponse {
  items?: PmdbSkip[] | null;
}

interface Candidate {
  startMs: number;
  endMs: number;
  physical: boolean;
  created: number;
}

const FIELDS: [SegmentType, 'intro' | 'credits'][] = [
  ['Intro', 'intro'],
  ['Outro', 'credits'],
];

/** Hand-entered timestamps for one cut differ by a few seconds. */
const AGREE_MS = 5000;

function candidateOf(
  row: PmdbSkip,
  field: 'intro' | 'credits'
): Candidate | null {
  const startMs = row[`${field}_start_ms`];
  const endMs = row[`${field}_end_ms`];
  if (typeof startMs !== 'number' || typeof endMs !== 'number') return null;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs)
    return null;
  return {
    startMs,
    endMs,
    physical: row.source === 'physical',
    created: Date.parse(row.updated ?? row.created ?? '') || 0,
  };
}

/** One row per contributor, so agreement doubles as the submission count. */
function pick(
  rows: PmdbSkip[],
  field: 'intro' | 'credits',
  minSubmissions: number
): Candidate | null {
  const all = rows.flatMap((row) => candidateOf(row, field) ?? []);
  const streaming = all.filter((c) => !c.physical);
  const pool = streaming.length ? streaming : all;

  let best: Candidate | null = null;
  let bestAgree = 0;
  for (const candidate of pool) {
    const agree = pool.filter(
      (other) =>
        Math.abs(other.startMs - candidate.startMs) <= AGREE_MS &&
        Math.abs(other.endMs - candidate.endMs) <= AGREE_MS
    ).length;
    if (
      agree > bestAgree ||
      (agree === bestAgree && best && candidate.created > best.created)
    ) {
      best = candidate;
      bestAgree = agree;
    }
  }
  return best && bestAgree >= minSubmissions ? best : null;
}

function slotsOf(lookup: SegmentLookup) {
  if (lookup.tmdbEpisodes) return lookup.tmdbEpisodes;
  return lookup.season != null && lookup.episode
    ? [{ season: lookup.season, episode: lookup.episode }]
    : [];
}

async function skips(
  lookup: SegmentLookup,
  ctx: ProviderContext,
  slot?: { season: number; episode: number }
): Promise<PmdbSkip[]> {
  const params = new URLSearchParams({
    tmdb_id: String(lookup.ids.tmdb),
    media_type: lookup.kind === 'movie' ? 'movie' : 'tv',
  });
  if (slot) {
    params.set('season', String(slot.season));
    params.set('episode', String(slot.episode));
  }
  const response = await makeRequest(
    `${ctx.baseUrl.replace(/\/+$/, '')}/api/external/skips?${params}`,
    {
      timeout: ctx.timeoutMs,
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${ctx.pmdbApiKey}`,
        'user-agent': appConfig.http.defaultUserAgent,
      },
    }
  );
  if (response.status === 404) return [];
  if (!response.ok) throw new Error(`PublicMetaDB answered ${response.status}`);
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json'))
    throw new Error(
      `PublicMetaDB answered ${response.status} with ${contentType}`
    );

  const body = (await response.json()) as PmdbSkipsResponse;
  return Array.isArray(body?.items) ? body.items : [];
}

function toSegments(rows: PmdbSkip[], ctx: ProviderContext): Segment[] {
  const out: Segment[] = [];
  for (const [type, field] of FIELDS) {
    const chosen = pick(rows, field, ctx.minSubmissions);
    if (chosen)
      out.push({
        type,
        startMs: chosen.startMs,
        endMs: chosen.endMs,
        provider: 'pmdb',
      });
  }
  return out;
}

/** TMDB-keyed. Submissions carry no recap. */
export const pmdbProvider: SegmentProvider = {
  id: 'pmdb',
  name: 'PublicMetaDB',
  defaultBaseUrl: 'https://publicmetadb.com',
  kinds: ['episode', 'movie'],
  idKeys: ['tmdb'],
  configurationKey: 'pmdbApiKey',

  configured(ctx) {
    return !!ctx.pmdbApiKey;
  },

  supports(lookup) {
    if (!lookup.ids.tmdb) return false;
    return lookup.kind === 'movie' || slotsOf(lookup).length > 0;
  },

  async fetch(lookup: SegmentLookup, ctx: ProviderContext) {
    if (lookup.kind === 'movie')
      return toSegments(await skips(lookup, ctx), ctx);
    for (const slot of slotsOf(lookup)) {
      const segments = toSegments(await skips(lookup, ctx, slot), ctx);
      if (segments.length) return segments;
    }
    return [];
  },
};
