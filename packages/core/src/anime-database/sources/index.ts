/**
 * Registry of every {@link AnimeSource} adapter.
 *
 * Order is the load/refresh order; later entries override earlier ones for
 * conflicting per-system hints (the merger uses last-writer-wins per field
 * within a record):
 *   fribb (broad) -> manami (titles) -> kitsu-imdb (imdb hints) ->
 *   anitrakt-{movies,tv} -> anime-list-xml (offsets) -> animeapi (modern).
 */
import type { AnimeSource } from './base.js';
import { fribbSource } from './fribb.js';
import { manamiSource } from './manami.js';
import { kitsuImdbSource } from './kitsu-imdb.js';
import { anitraktMoviesSource } from './anitrakt-movies.js';
import { anitraktTvSource } from './anitrakt-tv.js';
import { animeListXmlSource } from './anime-list-xml.js';
import { animeApiSource } from './animeapi.js';

export const ANIME_SOURCES: readonly AnimeSource[] = [
  fribbSource,
  manamiSource,
  kitsuImdbSource,
  anitraktMoviesSource,
  anitraktTvSource,
  animeListXmlSource,
  animeApiSource,
];

export type { AnimeSource } from './base.js';
