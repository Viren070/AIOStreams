import { z } from 'zod';
import { createLogger } from '../../../logging/logger.js';
import { makeRequest } from '../../../utils/http.js';
import type { SuggestionProvider, TitleSuggestion } from '../types.js';
import { completes, distinctNames, titleWords } from '../words.js';

const logger = createLogger('jellyfin');

const FEED_URL = 'https://cinemeta-catalogs.strem.io/feed.json';
// The list's own max-age.
const FEED_TTL_MS = 8 * 3600_000;
const TIMEOUT_MS = 30_000;
const RETRY_MS = 60_000;
const START_MAX = 4;

const FeedItem = z.object({
  id: z.string().startsWith('tt'),
  type: z.enum(['movie', 'series']),
  name: z.string().min(1),
  releaseInfo: z.string().nullish(),
  popularity: z.number().nullish(),
});

interface Entry {
  suggestion: TitleSuggestion;
  words: string[];
  /** The words joined, to match a term as the start of the title. */
  name: string;
}

interface FeedIndex {
  /** Most popular first. */
  entries: Entry[];
  /** Entries by the first one to four letters of each of their words, most popular first. */
  byStart: Map<string, number[]>;
  loadedAt: number;
}

let feed: FeedIndex | null = null;
let loading: Promise<void> | null = null;
let failedAt = 0;

/** Cinemeta's list of popular movies and series, held in memory. */
export const cinemetaProvider: SuggestionProvider = {
  id: 'cinemeta',
  name: 'Cinemeta',

  async suggest({ words, kinds, limit }) {
    const index = await feedIndex();
    if (!index) return [];
    const term = words.join(' ');
    const candidates = words
      .map((w) => index.byStart.get(w.slice(0, START_MAX)) ?? [])
      .reduce((a, b) => (b.length < a.length ? b : a));
    const wanted = new Set(kinds);
    // Titles starting with the term rank above those merely containing its words.
    const leading: TitleSuggestion[] = [];
    const within: TitleSuggestion[] = [];
    const enough = limit * 2;
    for (const i of candidates) {
      const entry = index.entries[i];
      if (!wanted.has(entry.suggestion.type)) continue;
      if (entry.name.startsWith(term)) {
        leading.push(entry.suggestion);
        if (leading.length >= enough) break;
      } else if (within.length < enough && completes(entry.words, words)) {
        within.push(entry.suggestion);
      }
    }
    return distinctNames([...leading, ...within]);
  },
};

async function feedIndex(): Promise<FeedIndex | null> {
  const stale = !feed || Date.now() - feed.loadedAt > FEED_TTL_MS;
  if (stale && !loading && Date.now() - failedAt > RETRY_MS) {
    loading = loadFeed().finally(() => (loading = null));
  }
  // A stale list keeps answering while the next one downloads.
  if (!feed && loading) await loading;
  return feed;
}

async function loadFeed(): Promise<void> {
  try {
    const response = await makeRequest(FEED_URL, {
      timeout: TIMEOUT_MS,
      ignoreRecursion: true,
      headers: { accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`returned ${response.status}`);
    const items = z.array(z.unknown()).parse(await response.json());
    feed = buildIndex(
      items.flatMap((raw) => {
        const item = FeedItem.safeParse(raw);
        return item.success ? [item.data] : [];
      })
    );
    logger.debug(
      { titles: feed.entries.length },
      'loaded the Cinemeta suggestion list'
    );
  } catch (err) {
    failedAt = Date.now();
    logger.warn(
      { err: (err as Error).message },
      'failed to load the Cinemeta suggestion list'
    );
  }
}

function buildIndex(items: z.infer<typeof FeedItem>[]): FeedIndex {
  const sorted = [...items].sort(
    (a, b) => (b.popularity ?? 0) - (a.popularity ?? 0)
  );
  const entries: Entry[] = [];
  const byStart = new Map<string, number[]>();
  for (const item of sorted) {
    const words = titleWords(item.name);
    if (!words.length) continue;
    const year = parseInt(item.releaseInfo ?? '', 10);
    const at = entries.length;
    entries.push({
      suggestion: {
        id: item.id,
        type: item.type,
        name: item.name,
        year: Number.isFinite(year) ? year : undefined,
      },
      words,
      name: words.join(' '),
    });
    const starts = words.flatMap((w) =>
      Array.from({ length: START_MAX }, (_, n) => w.slice(0, n + 1))
    );
    for (const start of new Set(starts)) {
      const bucket = byStart.get(start);
      if (bucket) bucket.push(at);
      else byStart.set(start, [at]);
    }
  }
  return { entries, byStart, loadedAt: Date.now() };
}
