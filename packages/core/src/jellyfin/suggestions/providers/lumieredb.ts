import { z } from 'zod';
import { config as appConfig } from '../../../config/index.js';
import { makeRequest } from '../../../utils/http.js';
import type { ContentKind } from '../../library.js';
import type { SuggestionProvider } from '../types.js';
import { completes, distinctNames, titleWords } from '../words.js';

// `/search/suggest` takes 2-80 characters and answers at most 15 titles.
const MAX_TERM = 80;
const LIMIT = 15;
const TIMEOUT_MS = 2000;

const KINDS: Record<string, ContentKind> = {
  movie: 'movie',
  tvmovie: 'movie',
  tvseries: 'series',
  tvminiseries: 'series',
};

const SuggestResponse = z.object({
  items: z.array(
    z.object({
      tconst: z.string(),
      titleType: z.string(),
      primaryTitle: z.string(),
      originalTitle: z.string().nullish(),
      startYear: z.number().nullish(),
    })
  ),
});

/** A self-hosted index of IMDb's datasets, which tolerates typos. */
export const lumiereDbProvider: SuggestionProvider = {
  id: 'lumieredb',
  name: 'LumiereDB',
  cacheTtl: 300,

  configured: () => !!appConfig.jellyfin.lumiereDbUrl,

  async suggest({ term, words, kinds }) {
    const params = new URLSearchParams({
      query: Array.from(term.replace(/\s+/g, ' ')).slice(0, MAX_TERM).join(''),
      limit: String(LIMIT),
    });
    if (kinds.length === 1)
      params.set('type', kinds[0] === 'movie' ? 'movies' : 'series');
    const response = await makeRequest(
      `${appConfig.jellyfin.lumiereDbUrl}/search/suggest?${params}`,
      {
        timeout: TIMEOUT_MS,
        ignoreRecursion: true,
        headers: { accept: 'application/json' },
      }
    );
    if (!response.ok) {
      // A refused query rather than a server that is down.
      if (response.status < 500) return [];
      throw new Error(`returned ${response.status}`);
    }
    const { items } = SuggestResponse.parse(await response.json());
    return distinctNames(
      items.flatMap((item) => {
        const type = KINDS[item.titleType.toLowerCase()];
        if (!type || !item.tconst.startsWith('tt')) return [];
        const original = item.originalTitle && titleWords(item.originalTitle);
        // An original title only counts from its start.
        if (
          original &&
          !completes(titleWords(item.primaryTitle), words) &&
          completes(original, words) &&
          !original.join(' ').startsWith(words.join(' '))
        )
          return [];
        return [
          {
            id: item.tconst,
            type,
            name: item.primaryTitle,
            year: item.startYear ?? undefined,
          },
        ];
      })
    );
  },
};
