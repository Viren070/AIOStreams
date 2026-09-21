import { appConfig } from '../../../index.js';
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
  post_credits?: IntroDbSegment | null;
}

type Field = 'intro' | 'recap' | 'outro';

const EPISODE_FIELDS: [Field, SegmentType][] = [
  ['intro', 'Intro'],
  ['recap', 'Recap'],
  ['outro', 'Outro'],
];

/** Movies only define end credits; stray intro rows sit inside the credits. */
const MOVIE_FIELDS: [Field, SegmentType][] = [['outro', 'Outro']];

function msOf(ms: unknown, sec: unknown): number | null {
  if (typeof ms === 'number' && Number.isFinite(ms)) return ms;
  if (typeof sec === 'number' && Number.isFinite(sec)) return sec * 1000;
  return null;
}

/**
 * IMDb-keyed. Episodes need season and episode (a 400 without), movies need
 * `is_movie`. An unknown title answers 200 with null fields rather than an error.
 */
export const introDbProvider: SegmentProvider = {
  id: 'introdb',
  name: 'IntroDB',
  defaultBaseUrl: 'https://api.introdb.app',
  kinds: ['episode', 'movie'],
  idKeys: ['imdb'],

  supports(lookup) {
    if (!lookup.ids.imdb) return false;
    return (
      lookup.kind === 'movie' ||
      (lookup.season != null && lookup.episode != null)
    );
  },

  async fetch(lookup: SegmentLookup, ctx: ProviderContext) {
    const movie = lookup.kind === 'movie';
    const params = new URLSearchParams({ imdb_id: String(lookup.ids.imdb) });
    if (movie) {
      params.set('is_movie', 'true');
    } else {
      params.set('season', String(lookup.season));
      params.set('episode', String(lookup.episode));
    }
    const response = await makeRequest(
      `${ctx.baseUrl.replace(/\/+$/, '')}/segments?${params}`,
      {
        timeout: ctx.timeoutMs,
        headers: {
          accept: 'application/json',
          'user-agent': appConfig.http.defaultUserAgent,
        },
      }
    );
    if (!response.ok) return [];
    const body = (await response.json()) as IntroDbResponse;
    const stingerMs = msOf(
      body?.post_credits?.start_ms,
      body?.post_credits?.start_sec
    );

    const out: Segment[] = [];
    for (const [field, type] of movie ? MOVIE_FIELDS : EPISODE_FIELDS) {
      const raw = body?.[field];
      if (!raw) continue;
      const startMs = msOf(raw.start_ms, raw.start_sec);
      let endMs = msOf(raw.end_ms, raw.end_sec);
      if (startMs === null || endMs === null) continue;
      // Skipping the credits must land on a mid-credits scene, not past it.
      if (
        type === 'Outro' &&
        stingerMs !== null &&
        stingerMs > startMs &&
        stingerMs < endMs
      )
        endMs = stingerMs;
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
