import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import '../utils/index.js';
import { IdParser } from '../utils/id-parser.js';
import { buildAnimeEntry } from './builder.js';
import { selectBestRecord } from './selector.js';
import { AnimeType, type AnimeRecord } from './types.js';
import {
  getExternalEntryEpisode,
  mapExternalEpisodeToTmdb,
} from './episode-coordinates.js';

// The first three TYBW records can carry older IMDb hints for the standalone
// show, while TVDB/TMDB group all four cours under the original parent show.
const cours: AnimeRecord[] = [1, 14, 27, 41].map((start, i) => ({
  rid: i,
  type: AnimeType.TV,
  ids: { imdbId: 'tt0434665', thetvdbId: 74796, themoviedbId: 30984 },
  imdb: i < 3 ? { fromSeason: i + 1, fromEpisode: 1 } : undefined,
  tvdb: { seasonNumber: 17, fromEpisode: start },
  tmdb: { seasonNumber: 2, fromEpisode: start },
}));

describe('external anime episode selection and translation', () => {
  it('tolerates missing IDs on a partial candidate without inventing a shared parent', () => {
    const partial = { ...cours[0], ids: undefined } as unknown as AnimeRecord;
    assert.doesNotThrow(() =>
      selectBestRecord([partial, cours[3]], 'imdbId', 'tt0434665', 17, 48)
    );
    assert.deepEqual(buildAnimeEntry(partial).mappings, {});
  });

  it('normalizes numeric-string seasons throughout selection and translation', () => {
    const records = cours.map((record) => ({
      ...record,
      imdb: record.imdb
        ? { ...record.imdb, fromSeason: String(record.imdb.fromSeason) }
        : undefined,
      tvdb: { ...record.tvdb, seasonNumber: '17' },
      tmdb: { ...record.tmdb, seasonNumber: '2' },
    })) as unknown as AnimeRecord[];
    const chosen = selectBestRecord(records, 'imdbId', 'tt0434665', 17, 48);
    assert.equal(chosen, records[3]);
    const entry = buildAnimeEntry(chosen!);
    for (const id of [
      'tt0434665:17:48',
      'tvdb:74796:17:48',
      'tmdb:30984:2:48',
    ]) {
      const parsed = IdParser.parse(id, 'series')!;
      assert.equal(getExternalEntryEpisode(parsed, entry), 8);
      assert.deepEqual(mapExternalEpisodeToTmdb(parsed, entry), {
        seasonNumber: 2,
        episodeNumber: 48,
      });
    }
    const native = {
      ...entry,
      imdb: { seasonNumber: '4', fromEpisode: '1' },
    } as unknown as typeof entry;
    assert.equal(
      getExternalEntryEpisode(
        IdParser.parse('tt0434665:4:8', 'series')!,
        native
      ),
      8
    );
  });

  it('does not coerce absent or special season hints into season zero', () => {
    for (const season of [undefined, null, '', 'a', 'no-season']) {
      const entry = buildAnimeEntry(cours[3]);
      entry.tvdb.seasonNumber = season as never;
      assert.equal(
        getExternalEntryEpisode(
          IdParser.parse('tvdb:74796:0:8', 'series')!,
          entry
        ),
        undefined
      );
    }
  });

  for (const [episode, cour] of [
    [1, 0],
    [13, 0],
    [14, 1],
    [26, 1],
    [27, 2],
    [40, 2],
    [41, 3],
    [47, 3],
    [48, 3],
  ]) {
    it(`selects cour ${cour + 1} for the parent show's episode ${episode}`, () => {
      const chosen = selectBestRecord(
        cours,
        'imdbId',
        'tt0434665',
        17,
        episode
      );
      assert.equal(chosen, cours[cour]);
      const id = IdParser.parse(`tt0434665:17:${episode}`, 'series')!;
      assert.equal(
        getExternalEntryEpisode(id, buildAnimeEntry(chosen!)),
        episode - [1, 14, 27, 41][cour] + 1
      );
      assert.deepEqual(mapExternalEpisodeToTmdb(id, buildAnimeEntry(chosen!)), {
        seasonNumber: 2,
        episodeNumber: episode,
      });
    });
  }

  it('handles records whose separate IMDb IDs have been preserved', () => {
    const original: AnimeRecord = {
      ...cours[0],
      rid: 10,
      imdb: { fromSeason: 1, fromEpisode: 1 },
      tvdb: { seasonNumber: 'a' },
      tmdb: { seasonNumber: 1 },
    };
    assert.equal(
      selectBestRecord([original, cours[3]], 'imdbId', 'tt0434665', 17, 48),
      cours[3]
    );
  });

  it('does not replace an original series with a separately identified sequel', () => {
    const original: AnimeRecord = {
      ...cours[0],
      imdb: { fromSeason: 1, fromEpisode: 1 },
      tvdb: { seasonNumber: 1 },
      tmdb: { seasonNumber: 1 },
    };
    const sequel: AnimeRecord = {
      ...cours[3],
      ids: { imdbId: 'tt0434665', thetvdbId: 999, themoviedbId: 888 },
      tvdb: { seasonNumber: 3 },
      tmdb: { seasonNumber: 3 },
    };
    assert.equal(
      selectBestRecord([original, sequel], 'imdbId', 'tt0434665', 3, 5),
      original
    );
  });

  it('keeps native exact matches authoritative', () => {
    assert.equal(
      selectBestRecord(cours, 'imdbId', 'tt0434665', 3, 8),
      cours[2]
    );
  });

  it('keeps interpolation between known IMDb seasons', () => {
    const later = { ...cours[3], imdb: { fromSeason: 20, fromEpisode: 1 } };
    assert.equal(
      selectBestRecord([cours[2], later], 'imdbId', 'tt0434665', 17, 48),
      cours[2]
    );
  });

  it('does not promote a cour whose episode range has not started', () => {
    const original = { ...cours[0], tvdb: undefined, tmdb: undefined };
    assert.equal(
      selectBestRecord([original, cours[3]], 'imdbId', 'tt0434665', 17, 40),
      original
    );
  });

  for (const id of ['tvdb:74796:17:48', 'tmdb:30984:2:48']) {
    it(`preserves the correct target for ${id}`, () => {
      assert.deepEqual(
        mapExternalEpisodeToTmdb(
          IdParser.parse(id, 'series')!,
          buildAnimeEntry(cours[3])
        ),
        {
          seasonNumber: 2,
          episodeNumber: 48,
        }
      );
    });
  }

  it('translates unequal source and target episode starts', () => {
    const entry = buildAnimeEntry({
      ...cours[3],
      imdb: { fromSeason: 4, fromEpisode: 1 },
    });
    assert.deepEqual(
      mapExternalEpisodeToTmdb(
        IdParser.parse('tt0434665:4:8', 'series')!,
        entry
      ),
      {
        seasonNumber: 2,
        episodeNumber: 48,
      }
    );
  });

  for (const id of ['kitsu:49444:8', 'mal:60636:8']) {
    it(`leaves ${id} to the separate seasonless mapping path`, () => {
      const parsed = IdParser.parse(id, 'series')!;
      parsed.season = '17';
      parsed.episode = '48';
      assert.equal(
        mapExternalEpisodeToTmdb(parsed, buildAnimeEntry(cours[3])),
        undefined
      );
    });
  }

  it('declines unavailable, out-of-range and non-linear source mappings', () => {
    const entry = buildAnimeEntry(cours[3]);
    assert.equal(
      mapExternalEpisodeToTmdb(
        IdParser.parse('tt0434665:18:48', 'series')!,
        entry
      ),
      undefined
    );
    assert.equal(
      mapExternalEpisodeToTmdb(
        IdParser.parse('tvdb:74796:17:4', 'series')!,
        entry
      ),
      undefined
    );
    entry.imdb = { seasonNumber: 17, fromEpisode: 41, nonImdbEpisodes: [2] };
    assert.equal(
      mapExternalEpisodeToTmdb(
        IdParser.parse('tt0434665:17:48', 'series')!,
        entry
      ),
      undefined
    );
  });
});
