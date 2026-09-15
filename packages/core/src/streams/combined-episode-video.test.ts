import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ParsedStream, UserData } from '../db/schemas.js';
import FileParser from '../parser/file.js';
import { settingsStore } from '../config/index.js';
import { SettingsRepository } from '../db/repositories/settings.js';
import { RegexAccess } from '../utils/regex-access.js';
import type { StreamContext } from './context.js';
import StreamFilterer from './filterer.js';
import { isCombinedEpisodeVideo } from './combined-episode-video.js';

const stream = (filename: string, extra: Partial<ParsedStream> = {}) =>
  ({
    id: filename,
    type: 'usenet',
    filename,
    parsedFile: FileParser.parse(filename),
    addon: { preset: { id: 'newznab' } },
    ...extra,
  }) as ParsedStream;

describe('combined episode videos', () => {
  it('preserves only verified dual-numbered single episodes, not explicit ranges', () => {
    const request = { season: 17, episode: 47, absoluteEpisode: 413 };
    assert.equal(
      isCombinedEpisodeVideo(stream('Bleach S17E47-413 1080p.mkv'), request),
      false
    );
    for (const filename of [
      'Bleach S17E47-413 1080p.mkv',
      'Bleach S17E47-E413.mkv',
      'Bleach S17E45-48.mkv',
    ]) {
      assert.equal(isCombinedEpisodeVideo(stream(filename)), true);
    }
    for (const filename of ['Bleach S17E47-E413.mkv', 'Bleach S17E45-48.mkv']) {
      assert.equal(isCombinedEpisodeVideo(stream(filename), request), true);
    }
    assert.equal(
      isCombinedEpisodeVideo(stream('Bleach S17E47-413.mkv'), {
        ...request,
        absoluteEpisode: 414,
      }),
      true
    );
    assert.equal(
      isCombinedEpisodeVideo(stream('Example S02E01-25.mkv'), {
        season: 2,
        episode: 1,
        absoluteEpisode: 25,
      }),
      true
    );
  });
  for (const filename of [
    'One_Piece_-_277-278_-_RAW_-_1280x720.mkv',
    '[ADC-Elites]_One_Piece_277-278_[FB3FBBCD].avi',
    '[K-F]_One_Piece_277-278_[F8B01999].mp4',
    '[KaMi]_one_piece__277-278_(720p)_(kf).mkv',
    '[Sayig].One.Piece.-.277-278.[396p][6F4529F8].avi',
    'One.Piece.S11E51E52.1080p.mkv',
    'Bleach.S01E01-E02.MKV',
  ]) {
    it(`recognises ${filename}`, () => {
      assert.equal(isCombinedEpisodeVideo(stream(filename)), true);
    });
  }
  it('recognises extensionless Easynews playback without assuming every title is a video', () => {
    const filename = '[KaMi] one piece 277-278 (720p) (kf)';
    assert.equal(isCombinedEpisodeVideo(stream(filename)), false);
    assert.equal(
      isCombinedEpisodeVideo(
        stream(filename, {
          service: { id: 'easynews', cached: true },
        })
      ),
      true
    );
  });
  for (const filename of [
    'Bleach 100-300',
    'Bleach 100-300.nzb',
    'Bleach 100-300.torrent',
    'Bleach 100-300.zip',
    'Bleach S01',
    'Bleach 100-300/Bleach 278.mkv',
    'Bleach 100-300\\Bleach 278.mkv',
    'One.Piece.278.mkv',
    'One.Piece.S11E52.mkv',
    'Show.2026.09.14.mkv',
  ]) {
    it(`preserves ${filename}`, () => {
      assert.equal(isCombinedEpisodeVideo(stream(filename)), false);
    });
  }
  it('ignores inherited folder ranges, but does not exempt combined files inside packs', () => {
    const folderName = 'Bleach 100-300';
    assert.equal(
      isCombinedEpisodeVideo(
        stream('video.mkv', {
          folderName,
          parsedFile: FileParser.parse(folderName),
        })
      ),
      false
    );
    assert.equal(
      isCombinedEpisodeVideo(
        stream('Bleach 277-278.mkv', {
          folderName,
          parsedFile: { ...FileParser.parse(folderName), seasonPack: true },
        })
      ),
      true
    );
  });
});

describe('combined video episode matching independent of title ambiguity mode', () => {
  it('handles western cartoon segments by filename, without rejecting single-number files based on runtime', async (t) => {
    t.mock.method(SettingsRepository, 'getAll', async () => []);
    t.mock.method(SettingsRepository, 'getVersion', async () => 0);
    await settingsStore.initialise();
    t.mock.method(RegexAccess, 'isRegexAllowed', async () => false);
    for (const title of ['SpongeBob SquarePants', 'Teen Titans Go']) {
      const context = {
        type: 'series',
        id: 'test:1:12',
        isAnime: false,
        parsedId: { type: 'imdbId', season: '1', episode: '12' },
        getMetadata: async () => ({ title, titles: [{ title }], runtime: 11 }),
        getReleaseDates: async () => undefined,
        getEpisodeAirDate: async () => undefined,
        getEpisodeRuntime: async () => 11,
        toExpressionContext: () => ({}),
      } as unknown as StreamContext;
      for (const ambiguousResults of ['keep', 'discard'] as const) {
        const streams = [
          stream(`${title}.S01E12.mkv`, { id: 'short', duration: 11 * 60_000 }),
          stream(`${title}.S01E12.mkv`, { id: 'long', duration: 22 * 60_000 }),
          stream(`${title}.S01E12E13.mkv`, {
            id: 'pair',
            duration: 22 * 60_000,
          }),
          stream(`${title}.S01E12.mkv`, {
            id: 'pack-file',
            folderName: `${title}.S01E01-E40`,
          }),
          stream(`${title}.S01`, { id: 'pack' }),
        ];
        const filter = new StreamFilterer({
          titleMatching: { enabled: true, mode: 'exact', ambiguousResults },
          seasonEpisodeMatching: { enabled: true, strict: true },
        } as UserData);
        assert.deepEqual(
          (await filter.filter(streams, context)).map((s) => s.id),
          ['short', 'long', 'pack-file', 'pack']
        );
      }
    }
  });
  it('filters files for MAL/Kitsu and IMDb/TVDB, preserving packs and matching settings', async (t) => {
    t.mock.method(SettingsRepository, 'getAll', async () => []);
    t.mock.method(SettingsRepository, 'getVersion', async () => 0);
    await settingsStore.initialise();
    t.mock.method(RegexAccess, 'isRegexAllowed', async () => false);
    for (const idType of ['kitsuId', 'malId', 'imdbId', 'thetvdbId']) {
      const native = idType === 'kitsuId' || idType === 'malId';
      const season = native ? 1 : 11;
      const episode = native ? 278 : 52;
      const context = {
        type: 'series',
        id: `test-${idType}`,
        isAnime: true,
        parsedId: {
          type: idType,
          season: String(season),
          episode: String(episode),
        },
        getMetadata: async () => ({
          title: 'One Piece',
          titles: [{ title: 'One Piece' }],
          absoluteEpisode: 278,
          relativeAbsoluteEpisode: 278,
        }),
        getReleaseDates: async () => undefined,
        getEpisodeAirDate: async () => undefined,
        getEpisodeRuntime: async () => undefined,
        toExpressionContext: () => ({}),
      } as unknown as StreamContext;
      const makeStreams = () => [
        stream('One.Piece.-.278.mkv'),
        stream(`One.Piece.S${season}E${episode}.mkv`, {
          folderName: 'One Piece 100-300',
        }),
        stream('One Piece 100-300'),
        stream(`One.Piece.S${season}.1080p`),
        stream('One.Piece.277-278.mkv'),
        stream(`One.Piece.S${season}E${episode - 1}E${episode}.mkv`),
        stream('[KaMi] one piece 277-278 (720p) (kf)', {
          service: { id: 'easynews', cached: true },
        }),
      ];
      for (const mode of ['keep', 'discard', 'disabled'] as const) {
        const titleMatching = {
          enabled: mode !== 'disabled',
          mode: 'exact' as const,
          similarityThreshold: 1,
          ambiguousResults:
            mode === 'keep' ? ('keep' as const) : ('discard' as const),
        };
        for (const strict of [false, true]) {
          const run = (options: UserData['seasonEpisodeMatching']) =>
            new StreamFilterer({
              titleMatching,
              seasonEpisodeMatching: options,
            } as UserData).filter(makeStreams(), context);
          const result = await run({ enabled: true, strict });
          assert.deepEqual(
            result.map((s) => s.id),
            makeStreams()
              .slice(0, 4)
              .map((s) => s.id),
            `${idType}/${mode}/${strict}`
          );
          for (const options of [
            { enabled: false, strict },
            { enabled: true, strict, requestTypes: ['movie'] },
            { enabled: true, strict, addons: ['other-addon'] },
          ] as UserData['seasonEpisodeMatching'][]) {
            assert.equal(
              (await run(options)).length,
              7,
              'honor disabled/out-of-scope episode matching'
            );
          }
        }
      }
    }
  });
});
