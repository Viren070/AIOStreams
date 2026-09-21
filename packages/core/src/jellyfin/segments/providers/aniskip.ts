import { appConfig } from '../../../index.js';
import { makeRequest } from '../../../utils/http.js';
import type {
  ProviderContext,
  Segment,
  SegmentLookup,
  SegmentProvider,
  SegmentType,
} from '../types.js';

interface AniSkipResult {
  interval?: { startTime?: number; endTime?: number };
  skipType?: string;
  episodeLength?: number;
}

interface AniSkipResponse {
  found?: boolean;
  results?: AniSkipResult[];
}

const TYPES: Record<string, SegmentType> = {
  op: 'Intro',
  'mixed-op': 'Intro',
  ed: 'Outro',
  'mixed-ed': 'Outro',
  recap: 'Recap',
};

const REQUESTED = ['op', 'ed', 'recap', 'mixed-op', 'mixed-ed'];

/*
 * One episode can carry every type at once, each submitted against a different
 * release, so prefer the plain types over the mixed variants rather than
 * whatever order the response arrives in.
 */
const PREFERENCE: Record<string, number> = {
  op: 0,
  ed: 0,
  recap: 0,
  'mixed-op': 1,
  'mixed-ed': 1,
};

/** Past this a submission is for a different cut, not a different encode. */
const RELEASE_TOLERANCE = 0.1;
/** Submissions against one release disagree by fractions of a second. */
const SAME_RELEASE_S = 2;

/** `undefined` when there is nothing to choose with, `null` when none fits. */
function closestRelease(
  results: AniSkipResult[],
  runtimeMs?: number
): number | null | undefined {
  if (!runtimeMs) return undefined;
  let best: number | undefined;
  for (const result of results) {
    const length = result?.episodeLength;
    if (typeof length !== 'number' || length <= 0) continue;
    if (
      best === undefined ||
      Math.abs(length * 1000 - runtimeMs) < Math.abs(best * 1000 - runtimeMs)
    )
      best = length;
  }
  if (best === undefined) return undefined;
  return Math.abs(best * 1000 - runtimeMs) > runtimeMs * RELEASE_TOLERANCE
    ? null
    : best;
}

async function query(
  lookup: SegmentLookup,
  ctx: ProviderContext,
  episodeLength: number
): Promise<AniSkipResult[]> {
  const params = new URLSearchParams();
  for (const type of REQUESTED) params.append('types', type);
  params.set('episodeLength', String(episodeLength));
  const base = ctx.baseUrl.replace(/\/+$/, '');
  const response = await makeRequest(
    `${base}/v2/skip-times/${encodeURIComponent(String(lookup.ids.mal))}/${lookup.episode}?${params}`,
    {
      timeout: ctx.timeoutMs,
      headers: {
        accept: 'application/json',
        'user-agent': appConfig.http.defaultUserAgent,
      },
    }
  );
  // 404 is its normal "nothing submitted", not a fault.
  if (!response.ok) return [];
  const body = (await response.json()) as AniSkipResponse;
  if (!body?.found || !Array.isArray(body.results)) return [];
  return body.results;
}

/**
 * MAL-keyed, anime only. A length asks about that release alone, through a
 * window a few seconds wide that a runtime rounded to whole minutes rarely
 * lands in; 0 asks across every release, one submission per type. So discover
 * the lengths with 0, then ask again for whichever fits the runtime.
 */
export const aniSkipProvider: SegmentProvider = {
  id: 'aniskip',
  name: 'AniSkip',
  defaultBaseUrl: 'https://api.aniskip.com',
  kinds: ['episode'],
  idKeys: ['mal'],

  supports(lookup) {
    return lookup.kind === 'episode' && !!lookup.ids.mal && !!lookup.episode;
  },

  async fetch(lookup: SegmentLookup, ctx: ProviderContext) {
    const discovered = await query(lookup, ctx, 0);
    if (!discovered.length) return [];

    const release = closestRelease(discovered, lookup.runtimeMs);
    if (release === null) return [];
    let results = discovered;
    if (release !== undefined) {
      const exact = await query(lookup, ctx, release);
      results = exact.length
        ? exact
        : discovered.filter(
            (r) =>
              typeof r.episodeLength === 'number' &&
              Math.abs(r.episodeLength - release) < SAME_RELEASE_S
          );
    }

    const ordered = [...results].sort(
      (a, b) =>
        (PREFERENCE[String(a?.skipType ?? '').toLowerCase()] ?? 2) -
        (PREFERENCE[String(b?.skipType ?? '').toLowerCase()] ?? 2)
    );

    const out: Segment[] = [];
    for (const result of ordered) {
      const type = TYPES[String(result?.skipType ?? '').toLowerCase()];
      const start = result?.interval?.startTime;
      const end = result?.interval?.endTime;
      if (!type || typeof start !== 'number' || typeof end !== 'number')
        continue;
      out.push({
        type,
        startMs: start * 1000,
        endMs: end * 1000,
        provider: 'aniskip',
      });
    }
    return out;
  },
};
