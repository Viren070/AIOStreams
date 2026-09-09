import { makeRequest } from '../../../utils/http.js';
import type {
  ProviderContext,
  Segment,
  SegmentLookup,
  SegmentProvider,
  SegmentType,
} from '../types.js';

interface IntroDbSegment {
  start_ms?: number | null;
  end_ms?: number | null;
  start_sec?: number | null;
  end_sec?: number | null;
  confidence?: number | null;
  submission_count?: number | null;
}

interface IntroDbResponse {
  intro?: IntroDbSegment | null;
  recap?: IntroDbSegment | null;
  outro?: IntroDbSegment | null;
}

const FIELDS: [keyof IntroDbResponse, SegmentType][] = [
  ['intro', 'Intro'],
  ['recap', 'Recap'],
  ['outro', 'Outro'],
];

function msOf(ms: unknown, sec: unknown): number | null {
  if (typeof ms === 'number' && Number.isFinite(ms)) return ms;
  if (typeof sec === 'number' && Number.isFinite(sec)) return sec * 1000;
  return null;
}

/**
 * IMDb-keyed, episodes only: omitting season or episode is a 400, and an unknown
 * show answers 200 with null fields rather than an error.
 */
export const introDbProvider: SegmentProvider = {
  id: 'introdb',
  defaultBaseUrl: 'https://api.introdb.app',
  kinds: ['episode'],
  idKeys: ['imdb'],

  supports(lookup) {
    return (
      lookup.kind === 'episode' &&
      !!lookup.ids.imdb &&
      lookup.season != null &&
      lookup.episode != null
    );
  },

  async fetch(lookup: SegmentLookup, ctx: ProviderContext) {
    const params = new URLSearchParams({
      imdb_id: String(lookup.ids.imdb),
      season: String(lookup.season),
      episode: String(lookup.episode),
    });
    const response = await makeRequest(
      `${ctx.baseUrl.replace(/\/+$/, '')}/segments?${params}`,
      { timeout: ctx.timeoutMs, headers: { accept: 'application/json' } }
    );
    if (!response.ok) return [];
    const body = (await response.json()) as IntroDbResponse;

    const out: Segment[] = [];
    for (const [field, type] of FIELDS) {
      const raw = body?.[field];
      if (!raw) continue;
      const startMs = msOf(raw.start_ms, raw.start_sec);
      const endMs = msOf(raw.end_ms, raw.end_sec);
      if (startMs === null || endMs === null) continue;
      // Agreement, not accuracy: never which release was being watched.
      if (
        typeof raw.confidence === 'number' &&
        raw.confidence < ctx.minConfidence
      )
        continue;
      if ((raw.submission_count ?? 0) < ctx.minSubmissions) continue;
      out.push({ type, startMs, endMs, provider: 'introdb' });
    }
    return out;
  },
};
