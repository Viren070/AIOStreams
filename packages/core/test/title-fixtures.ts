import type { Metadata } from '../src/metadata/utils.js';
import type { ParsedStream } from '../src/db/schemas.js';
import type { SkyhookShow } from '../src/metadata/skyhook.js';
import FileParser from '../src/parser/file.js';
import { createTestStreamContext } from './helpers.js';

/** Fresh releases retain the real filename parser and allow explicit contradictions. */
export function release(
  filename: string,
  overrides: Partial<ParsedStream> = {}
): ParsedStream {
  return {
    id: filename,
    type: 'usenet',
    filename,
    parsedFile: FileParser.parse(filename),
    addon: { preset: { id: 'newznab' } },
    ...overrides,
  } as ParsedStream;
}

export function seriesContext(
  metadata: Metadata,
  overrides: Record<string, unknown> = {}
) {
  return createTestStreamContext({
    type: 'series',
    id: 'tt1234567:1:10',
    isAnime: false,
    parsedId: {
      type: 'imdbId',
      value: 'tt1234567',
      season: '1',
      episode: '10',
    },
    getMetadata: async () => metadata,
    ...overrides,
  });
}

/** Counts specify contiguous regular coordinates; status is always explicit. */
export function catalogue(
  tvdbId: number,
  counts: number[],
  status: string | undefined,
  overrides: Partial<SkyhookShow> = {}
): SkyhookShow {
  return {
    tvdbId,
    title: 'Shared Show',
    status,
    episodes: regularEpisodes(counts),
    ...overrides,
  };
}

export function regularEpisodes(counts: number[]) {
  return counts.flatMap((count, season) =>
    Array.from({ length: count }, (_, i) => ({
      seasonNumber: season + 1,
      episodeNumber: i + 1,
    }))
  );
}

export function namedCatalogue(
  tvdbId: number,
  names: string[],
  status = 'Ended',
  overrides: Partial<SkyhookShow> = {}
) {
  const show = catalogue(tvdbId, [names.length], status, overrides);
  show.episodes = names.map((title, i) => ({
    seasonNumber: 1,
    episodeNumber: i + 1,
    title,
  }));
  return show;
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}
