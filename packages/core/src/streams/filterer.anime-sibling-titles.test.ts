import assert from 'node:assert/strict';
import { before, after, describe, it, mock } from 'node:test';
import StreamFilterer from './filterer.js';
import FileParser from '../parser/file.js';
import type { StreamContext } from './context.js';
import type { ParsedStream, UserData } from '../db/schemas.js';
import { AnimeDatabase } from '../anime-database/database.js';
import { AnimeType, type AnimeRecord } from '../anime-database/types.js';
import { AnimeRepository } from '../db/repositories/anime.js';
import { settingsStore } from '../config/index.js';
import { SettingsRepository } from '../db/repositories/settings.js';
import { ReleaseBlocklistRepository } from '../db/repositories/release-blocklist.js';

const japanese = 'Yahari Ore no Seishun Love Comedy wa Machigatteiru';
const english = 'My Teen Romantic Comedy SNAFU';
const records: AnimeRecord[] = ['', 'Zoku', 'Kan'].map((suffix, index) => ({
  rid: 7185 + index,
  type: AnimeType.TV,
  ids: { imdbId: 'tt2703720', thetvdbId: 267435, kitsuId: 7185 + index },
  title: `${japanese}${suffix ? `. ${suffix}` : '.'}`,
  synonyms: [
    index === 1
      ? `${english} TOO!`
      : index === 2
        ? `${english} Climax`
        : english,
    'Oregairu', // Shared franchise shorthand must never be blocked.
    // Manami stores these after the primary title; sibling deduplication
    // retains the spaced spelling for the same normalized title.
    `${japanese.replace('Machigatteiru', 'Machigatte Iru')}${suffix ? `. ${suffix}` : '.'}`,
    `${japanese.replace('Comedy', 'Come')}${suffix ? `. ${suffix}` : '.'}`,
  ],
  imdb: { id: 'tt2703720', fromSeason: index + 1, fromEpisode: 1 },
  tvdb: { seasonNumber: index + 1 },
}));

before(async () => {
  mock.method(SettingsRepository, 'getAll', async () => []);
  mock.method(SettingsRepository, 'getVersion', async () => 0);
  mock.method(ReleaseBlocklistRepository, 'hasEntries', async () => false);
  mock.method(AnimeRepository, 'findCandidates', async (type, value) =>
    type === 'kitsuId'
      ? records.filter((r) => r.ids.kitsuId === value)
      : records
  );
  await settingsStore.initialise();
});
after(() => mock.restoreAll());

async function filterNames(
  names: string[],
  season = 1,
  options: {
    broadAliases?: boolean;
    enabled?: boolean;
    isAnime?: boolean;
    mode?: string;
    threshold?: number;
    episode?: number;
  } = {}
) {
  const episode = options.episode ?? 2;
  const entry = await AnimeDatabase.getInstance().getEntryById(
    'imdbId',
    'tt2703720',
    season,
    episode
  );
  assert.equal(entry?.title, records[season - 1].title);
  const titles = (options.broadAliases ? records : [records[season - 1]])
    .flatMap((r) => [r.title!, ...(r.synonyms ?? [])])
    .map((title) => ({ title }));
  const context = {
    type: 'series',
    id: `tt2703720:${season}:${episode}`,
    parsedId: {
      type: 'imdbId',
      value: 'tt2703720',
      season: String(season),
      episode: String(episode),
    },
    isAnime: options.isAnime ?? true,
    animeEntry: entry,
    getMetadata: async () => ({
      title: english,
      titles,
      absoluteEpisode: episode,
    }),
    getReleaseDates: async () => undefined,
    getEpisodeAirDate: async () => undefined,
    getEpisodeRuntime: async () => undefined,
    getPermittedPatterns: async () => ({
      permitted: new Set(),
      unrestricted: true,
    }),
    toExpressionContext: () => ({ type: 'series', isAnime: true }),
  } as unknown as StreamContext;
  const streams = names.map(
    (filename) =>
      ({
        id: filename,
        type: 'usenet',
        filename,
        parsedFile: FileParser.parse(filename),
        addon: { name: 'Test', preset: { id: 'test' } },
      }) as ParsedStream
  );
  const result = await new StreamFilterer({
    titleMatching: {
      enabled: options.enabled ?? true,
      mode: options.mode ?? 'exact',
      similarityThreshold: options.threshold ?? 0.85,
    },
    seasonEpisodeMatching: { enabled: true, strict: false },
  } as unknown as UserData).filter(streams, context);
  return result.map((stream) => stream.id);
}

describe('anime sibling title filtering', () => {
  const valid = [
    '[shiggy].My.Teen.Romantic.Comedy.SNAFU.-.S01E02.(BDRip.1920x1080.HEVC.FLAC).[062CB1CF].mkv',
    '[Coalgirls]_Yahari_Ore_no_Seishun_Love_Comedy_wa_Machigatteiru_02_(1920x1080_Blu-Ray_FLAC)_[95B13B77].mkv',
    '[Femme].Yahari.Ore.no.Seishun.Love.Comedy.wa.Machigatteiru.-.02.[BD.720p.Hi444PP.AAC][565444AF].mkv',
    'Oregairu - 02.mkv',
    `${japanese.replace('Comedy', 'Comdey')} - 02.mkv`,
  ];
  const wrong = [
    '[Lulu].Yahari.Ore.no.Seishun.Love.Comedy.wa.Machigatteiru..Kan.-.02.[BD.1080p.HEVC.FLAC][Dual-Audio].mkv',
    '[FFAst] Yahari Ore no Seishun Love Comedy wa Machigatteiru. Kan - 02 [BD][1080p][HEVC].mkv',
    '[Drag].Yahari.Ore.no.Seishun.Love.Comedy.wa.Machigatteiru..Zoku.-.02.(BD.1080p.x264.10-bit.FLAC).[A3744FDF].mkv',
    '[Lulu].My.Teen.Romantic.Comedy.SNAFU.TOO!.-.02.[BD.1080p.HEVC.FLAC][Dual-Audio].mkv',
    'stars-my.teen.romantic.comedy.snafu.too.e02.720p.mkv',
  ];
  for (const broadAliases of [false, true]) {
    for (const mode of ['exact', 'contains']) {
      it(`rejects the logged sequel titles with broad aliases ${broadAliases}, mode ${mode}`, async () => {
        assert.deepEqual(
          await filterNames([...valid, ...wrong], 1, { broadAliases, mode }),
          valid
        );
      });
    }
  }
  it('keeps Zoku for season 2 and Kan for season 3', async () => {
    assert.deepEqual(await filterNames([wrong[2], wrong[3]], 2), [
      wrong[2],
      wrong[3],
    ]);
    assert.deepEqual(await filterNames([wrong[0], wrong[1]], 3), [
      wrong[0],
      wrong[1],
    ]);
  });
  it('rejects the remaining Kan releases from the rebuilt S01E08 log', async () => {
    const good = [
      '[Coalgirls]_Yahari_Ore_no_Seishun_Love_Comedy_wa_Machigatteiru_08_(1920x1080_Blu-Ray_FLAC)_[95B13B77].mkv',
      '[Kaya].Yahari.Ore.no.Seishun.LoveCome.wa.Machigatte.Iru..-.08.mkv',
    ];
    const bad = [
      '[Lulu].Yahari.Ore.no.Seishun.Love.Comedy.wa.Machigatteiru..Kan.-.08.[BD.1080p.HEVC.FLAC][Dual-Audio].mkv',
      '[Scarlet.Team&Almighty].Yahari.Ore.no.Seishun.Love.Comedy.wa.Machigatteiru..Kan.-.08.[BD.1920x1080p.x264.FLAC][506CF566].mkv',
      'Yahari Ore no Seishun Love Comedy wa Machigatteiru. Kan - 08 [720p x264 AAC]',
    ];
    assert.ok(!FileParser.parse(bad[0]).title?.includes('Kan'));
    assert.deepEqual(
      await filterNames([...good, ...bad], 1, { episode: 8 }),
      good
    );
  });
  it('keeps known Kan titles even when exact full-title equality is required', async () => {
    assert.deepEqual(
      await filterNames([wrong[0], wrong[1]], 3, { threshold: 1 }),
      [wrong[0], wrong[1]]
    );
  });
  it('keeps a generic parent title with explicit correct season numbering', async () => {
    const names = [`${english}.S02E02.mkv`, `${japanese}.S02E02.mkv`];
    assert.deepEqual(await filterNames(names, 2), names);
  });
  it('does not let explicit local S01 numbering override a different sequel title', async () => {
    assert.deepEqual(
      await filterNames([
        `${japanese}.Kan.S01E02.mkv`,
        `${japanese}.Zoku.S01E02.mkv`,
      ]),
      []
    );
  });
  it('respects disabled title matching and non-anime scope', async () => {
    assert.deepEqual(await filterNames(wrong, 1, { enabled: false }), wrong);
    assert.deepEqual(
      await filterNames(wrong, 1, { isAnime: false, broadAliases: true }),
      wrong
    );
  });
  it('loads siblings through mapped show IDs for a unique Kitsu request', async () => {
    const entry = await AnimeDatabase.getInstance().getEntryById(
      'kitsuId',
      7185,
      undefined,
      2
    );
    assert.ok(
      entry?.siblingTitles?.includes(
        `${japanese.replace('Machigatteiru', 'Machigatte Iru')}. Kan`
      )
    );
    assert.ok(!entry?.siblingTitles?.includes('Oregairu'));
  });
  it('preserves the selected entry when optional mapped sibling lookups fail', async (t) => {
    t.mock.method(AnimeRepository, 'findCandidates', async (type) => {
      if (type === 'kitsuId') return [records[0]];
      throw new Error('mapped lookup unavailable');
    });
    const entry = await AnimeDatabase.getInstance().getEntryById(
      'kitsuId',
      7185,
      undefined,
      7
    );
    assert.equal(entry?.title, records[0].title);
    assert.equal(entry?.siblingTitles, undefined);
  });
});
