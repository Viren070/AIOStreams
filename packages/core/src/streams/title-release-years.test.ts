import './filterer.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import StreamFilterer from './filterer.js';
import { confirmsTitleIdentity } from './title-conflicts.js';
import {
  parseNabReleaseYear,
  nabCategoryIds,
  parseNabParsedFileInfo,
} from '../builtins/base/nab/addon.js';
import { getOriginalAudioLanguage } from './title-conflicts.js';
import FileParser from '../parser/file.js';
import { SkyhookMetadata } from '../metadata/skyhook.js';
import { RegexAccess } from '../utils/regex-access.js';
import type { ParsedStream, UserData } from '../db/schemas.js';
import {
  initialiseTestSettings,
  createTestStreamContext,
} from '../../test/helpers.js';

describe('indexed release year constraints', () => {
  it('reads only valid, consistent item years and never upload dates or query years', () => {
    for (const year of ['1994', 1994, '1994,1994', ' 1994 '])
      assert.equal(parseNabReleaseYear({ year }), '1994');
    for (const attrs of [
      {},
      { pubDate: '1994-01-01' },
      { usenetdate: '1994-01-01' },
      { year: '' },
      { year: '0' },
      { year: '2026-10-01' },
      { year: '1994,2001' },
      { year: '1994,' },
      { year: 'unknown' },
      { year: '1994-1995' },
      { year: '1e3' },
      { year: '-1994' },
    ])
      assert.equal(parseNabReleaseYear(attrs), undefined);
    assert.deepEqual(
      nabCategoryIds({ category: '5000,5070,5070,secret,https://invalid,0' }),
      [5000, 5070]
    );
  });

  it('preserves optional structured audio from either Nab feed without treating language lists as roles', () => {
    const info = parseNabParsedFileInfo({
      audioTracks: JSON.stringify([
        { lang: 'fra', original: true },
        { lang: 'eng', dub: true },
      ]),
      audioLanguages: 'French,English',
    });
    assert.equal(info?.mediaInfoQuality, 'indexer');
    assert.equal(getOriginalAudioLanguage(info), 'fr');
    assert.deepEqual(info?.languages, ['French', 'English']);
    for (const value of [
      'French',
      'Original',
      '{invalid}',
      JSON.stringify(['French', 'English']),
      JSON.stringify([{ lang: 'fra', default: true }]),
      JSON.stringify([{ lang: 'fra', original: 'true' }]),
      JSON.stringify([{ lang: 'fra', original: true, dub: true }]),
      JSON.stringify([{ lang: 'fra', original: true, visual_impaired: true }]),
      JSON.stringify([
        { lang: 'fra', original: true },
        { lang: 'eng', original: true },
      ]),
      ' '.repeat(65537),
      JSON.stringify(
        Array.from({ length: 129 }, () => ({ lang: 'fra', original: true }))
      ),
    ]) {
      const parsed = parseNabParsedFileInfo({
        audioTracks: value,
        audioLanguages: 'English',
      });
      assert.equal(getOriginalAudioLanguage(parsed), undefined);
      assert.ok(
        parsed?.languages?.includes('English'),
        'invalid extension must not erase standard language metadata'
      );
    }
  });

  it('requires corroboration and rejects contradictory item years', () => {
    const requested = { title: 'Shared Show', year: 1994, country: 'JP' };
    const other = [{ title: 'Shared Show', year: 2001, country: 'TW' }];
    assert.equal(
      confirmsTitleIdentity(requested, other, {
        releaseYear: '1994',
        year: '1994',
      }),
      true
    );
    assert.equal(
      confirmsTitleIdentity(requested, other, {
        releaseYear: '1995',
        episodeTitleMatches: true,
      }),
      true
    );
    for (const evidence of [
      {},
      { releaseYear: '1994' },
      { releaseYear: '1995' },
      { releaseYear: '2001' },
      { releaseYear: 'unknown' },
      { releaseYear: '1994', year: '2001' },
      { releaseYear: '1994', country: 'TW' },
      { releaseYear: '2001', year: '1994' },
      { releaseYear: '2001', episodeTitleMatches: true },
    ])
      assert.equal(confirmsTitleIdentity(requested, other, evidence), false);
    assert.equal(
      confirmsTitleIdentity(requested, [{ title: 'Shared Show' }], {
        releaseYear: '1994',
      }),
      false
    );
    assert.equal(
      confirmsTitleIdentity(requested, [{ title: 'Shared Show', year: 1994 }], {
        releaseYear: '1994',
      }),
      false
    );
    assert.equal(
      confirmsTitleIdentity({ title: 'Shared Show' }, other, {
        releaseYear: '1994',
      }),
      false
    );
    assert.equal(
      confirmsTitleIdentity(
        { ...requested, releaseYears: [1994, 1998] },
        other,
        { releaseYear: '1998', year: '1998' }
      ),
      true,
      'season/episode release years remain usable'
    );
  });

  it('does not identify ambiguous episodes by item year alone and retains strict guards', async (t) => {
    await initialiseTestSettings(t);
    t.mock.method(RegexAccess, 'isRegexAllowed', async () => false);
    t.mock.method(SkyhookMetadata.prototype, 'getShow', async (id) => ({
      tvdbId: id,
      title: 'Shared Show',
      episodes: Array.from({ length: 30 }, (_, i) => ({
        seasonNumber: 1,
        episodeNumber: i + 1,
      })),
    }));
    const metadata = {
      title: 'Shared Show',
      titles: [{ title: 'Shared Show' }],
      year: 1994,
      country: 'US',
      originalLanguage: 'en',
      tvdbId: 72421,
      absoluteEpisode: 10,
      seasons: [{ season_number: 1, episode_count: 76 }],
      episodeTitles: [{ title: 'A Real Episode Name' }],
      titleConflicts: [
        { title: 'Shared Show', year: 2001, country: 'US', tvdbId: 455890 },
      ],
    };
    const context = createTestStreamContext({
      type: 'series',
      id: 'tt0108850:1:10',
      isAnime: false,
      parsedId: {
        type: 'imdbId',
        value: 'tt0108850',
        season: '1',
        episode: '10',
      },
      getMetadata: async () => metadata,
    });
    const make = (
      filename: string,
      releaseYear?: string,
      extra: Partial<ParsedStream> = {}
    ): ParsedStream =>
      ({
        id: filename,
        type: 'usenet',
        filename,
        parsedFile: FileParser.parse(filename),
        releaseYear,
        addon: { preset: { id: 'newznab' } },
        ...extra,
      }) as ParsedStream;
    const options = {
      titleMatching: { enabled: true, ambiguousResults: 'discard' },
      yearMatching: { enabled: true },
      seasonEpisodeMatching: { enabled: true, strict: true },
      episodeTitleMatching: { enabled: true, similarityThreshold: 1 },
    } as UserData;
    const filter = new StreamFilterer(options);
    for (const type of [
      'usenet',
      'stremio-usenet',
      'p2p',
      'http',
      'debrid',
    ] as const) {
      assert.equal(
        (
          await filter.filter(
            [make('Shared.Show.S01E10.mkv', '1994', { type })],
            context
          )
        ).length,
        0,
        `${type}: a matching item year alone does not identify the release`
      );
      assert.equal(
        (
          await filter.filter(
            [make('Shared.Show.1994.S01E10.mkv', '1994', { type })],
            context
          )
        ).length,
        1,
        `${type}: a distinguishing filename year remains usable`
      );
    }
    for (const stream of [
      make('Shared.Show.S01E10.mkv'),
      make('Shared.Show.S01E10.mkv', '2001'),
      make('Shared.Show.S01E10.mkv', '2001', { releaseIds: { tvdbId: 72421 } }),
      make('Shared.Show.1994.S01E10.mkv', '2001'),
      make('Shared.Show.S01E11.mkv', '1994'),
      make('Shared.Show.1994.S01E10.mkv', '1994', {
        releaseIds: { tvdbId: 455890 },
      }),
      make('Shared.Show.S01E10.mkv', '1994', {
        parsedFile: {
          ...FileParser.parse('Shared.Show.S01E10.mkv'),
          country: 'JP',
        },
      }),
      make('Shared.Show.S01E10.mkv', '1994', {
        parsedFile: {
          ...FileParser.parse('Shared.Show.S01E10.mkv'),
          episodeTitle: 'A Different Event',
        },
      }),
    ])
      assert.equal(
        (await filter.filter([stream], context)).length,
        0,
        stream.filename
      );
    for (const titleMatching of [
      { enabled: false },
      { enabled: true, ambiguousResults: 'keep' },
      { enabled: true, ambiguousResults: 'discard', addons: ['other'] },
      { enabled: true, ambiguousResults: 'discard', requestTypes: ['movie'] },
    ])
      assert.equal(
        (
          await new StreamFilterer({
            ...options,
            titleMatching,
          } as UserData).filter(
            [make('Shared.Show.S01E10.mkv', '2001')],
            context
          )
        ).length,
        1,
        'item evidence respects title filter scope'
      );
  });
});
