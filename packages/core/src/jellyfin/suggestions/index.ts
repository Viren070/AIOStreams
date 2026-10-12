import { config as appConfig } from '../../config/index.js';
import { createLogger } from '../../logging/logger.js';
import { Cache } from '../../utils/cache.js';
import { SUGGESTION_PROVIDER_REGISTRY } from './providers/index.js';
import type { ContentKind } from '../library.js';
import type {
  SuggestionProvider,
  SuggestionQuery,
  TitleSuggestion,
} from './types.js';
import { titleWords } from './words.js';

export * from './types.js';

const logger = createLogger('jellyfin');

const MIN_TERM = 2;
const DOWN_MS = 30_000;
/** Needs no setup, so it stands in for a provider that isn't set up. */
const FALLBACK = SUGGESTION_PROVIDER_REGISTRY.cinemeta;

const cache = Cache.getInstance<string, TitleSuggestion[]>(
  'jellyfin:suggestions',
  5000,
  'memory'
);
const asking = new Map<string, Promise<TitleSuggestion[]>>();
const failedAt = new Map<SuggestionProvider['id'], number>();

/**
 * Titles completing a partly typed search, from the instance's provider;
 * null when it suggests from each configuration's catalog search instead.
 */
export async function suggestTitles(
  term: string,
  kinds: readonly ContentKind[],
  limit: number
): Promise<TitleSuggestion[] | null> {
  const source = appConfig.jellyfin.searchSuggestions;
  if (source === 'catalogs') return null;
  const trimmed = term.trim();
  const words = titleWords(trimmed);
  if (words.join(' ').length < MIN_TERM || !kinds.length || limit < 1)
    return [];
  const chosen = SUGGESTION_PROVIDER_REGISTRY[source];
  const provider = chosen.configured?.() === false ? FALLBACK : chosen;
  const found = await ask(provider, { term: trimmed, words, kinds, limit });
  return found.slice(0, limit);
}

async function ask(
  provider: SuggestionProvider,
  query: SuggestionQuery
): Promise<TitleSuggestion[]> {
  // A provider that is down would hold every keystroke for its whole timeout.
  if (Date.now() - (failedAt.get(provider.id) ?? 0) < DOWN_MS) return [];
  const ttl = provider.cacheTtl;
  if (!ttl) return (await attempt(provider, query)) ?? [];
  const key = [
    provider.id,
    [...query.kinds].sort().join(','),
    query.limit,
    query.words.join(' '),
  ].join('|');
  const cached = await cache.get(key);
  if (cached) return cached;
  let pending = asking.get(key);
  if (!pending) {
    pending = attempt(provider, query)
      .then(async (found) => {
        if (found) await cache.set(key, found, ttl);
        return found ?? [];
      })
      .finally(() => asking.delete(key));
    asking.set(key, pending);
  }
  return pending;
}

async function attempt(
  provider: SuggestionProvider,
  query: SuggestionQuery
): Promise<TitleSuggestion[] | null> {
  try {
    return await provider.suggest(query);
  } catch (err) {
    failedAt.set(provider.id, Date.now());
    logger.warn(
      { provider: provider.id, err: (err as Error).message },
      'search suggestions failed'
    );
    return null;
  }
}
