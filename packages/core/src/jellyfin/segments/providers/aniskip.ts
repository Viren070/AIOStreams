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

/**
 * MAL-keyed, anime only. It filters submissions against the episode length it is
 * given, the only release matching on offer anywhere, so send a real runtime
 * whenever one is known; 0 means "do not check".
 */
export const aniSkipProvider: SegmentProvider = {
  id: 'aniskip',
  defaultBaseUrl: 'https://api.aniskip.com',
  kinds: ['episode'],
  idKeys: ['mal'],

  supports(lookup) {
    return lookup.kind === 'episode' && !!lookup.ids.mal && !!lookup.episode;
  },

  async fetch(lookup: SegmentLookup, ctx: ProviderContext) {
    const params = new URLSearchParams();
    for (const type of REQUESTED) params.append('types', type);
    params.set(
      'episodeLength',
      String(lookup.runtimeMs ? Math.round(lookup.runtimeMs / 1000) : 0)
    );
    const base = ctx.baseUrl.replace(/\/+$/, '');
    const response = await makeRequest(
      `${base}/v2/skip-times/${encodeURIComponent(String(lookup.ids.mal))}/${lookup.episode}?${params}`,
      { timeout: ctx.timeoutMs, headers: { accept: 'application/json' } }
    );
    // 404 is its normal "nothing submitted", not a fault.
    if (!response.ok) return [];
    const body = (await response.json()) as AniSkipResponse;
    if (!body?.found || !Array.isArray(body.results)) return [];

    const ordered = [...body.results].sort(
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
