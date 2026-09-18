import { describe, it, before, after, mock } from 'node:test';
import { RegexAccess } from '../utils/regex-access.js';
import assert from 'node:assert/strict';
import StreamFilterer from './filterer.js';
import FileParser from '../parser/file.js';
import type { ParsedStream, UserData } from '../db/schemas.js';
import type { StreamContext } from './context.js';
import { selectEpisodeTitles } from '../metadata/episode-title-ordering.js';

const source = (title: string, airDate: string) => ({
  airDate,
  titles: [{ title, language: 'en' }],
});

async function filterTitles(options: {
  show?: string;
  aliases?: string[];
  provider?: string;
  titles: ReturnType<typeof selectEpisodeTitles>['titles'];
  candidates: string[];
  ambiguous?: boolean;
  enabled?: boolean;
  languages?: string[];
  parseFilenames?: boolean;
  threshold?: number;
}) {
  const show = options.show ?? 'Adventure Time';
  const filter = new StreamFilterer({
    titleMatching: { enabled: true, ambiguousResults: 'discard' },
    episodeTitleMatching: {
      enabled: options.enabled ?? true,
      similarityThreshold: options.threshold ?? 0.6,
    },
  } as UserData);
  const metadata = {
    title: show,
    titles: [show, ...(options.aliases ?? [])].map((title) => ({
      title,
      language: 'en',
    })),
    year: 2005,
    episodeTitles: options.titles,
    titleConflicts: options.ambiguous
      ? [{ title: show, year: 2001 }]
      : undefined,
  };
  const context = {
    type: 'series',
    id: 'tt0386676:1:2',
    isAnime: ['malId', 'kitsuId'].includes(options.provider ?? ''),
    parsedId: { type: options.provider ?? 'imdbId', season: '1', episode: '2' },
    getMetadata: async () => metadata,
    getReleaseDates: async () => undefined,
    getEpisodeAirDate: async () => undefined,
    getEpisodeRuntime: async () => undefined,
    toExpressionContext: () => ({}),
  } as unknown as StreamContext;
  const streams = options.candidates.map((title, index) => ({
    id: String(index),
    type: 'http',
    filename: options.parseFilenames ? title : `${show}.S01E02.${title}.mkv`,
    addon: { preset: { id: 'fixture' } },
    parsedFile: options.parseFilenames
      ? FileParser.parse(title)
      : {
          title: show,
          episodeTitle: title,
          languages: options.languages ?? [],
          seasons: [1],
          episodes: [2],
          audioTags: [],
          audioChannels: [],
          visualTags: [],
          subtitles: [],
        },
  })) as unknown as ParsedStream[];
  return (await filter.filter(streams, context)).map(
    (stream) => stream.parsedFile?.episodeTitle
  );
}

describe('episode ordering evidence in the actual stream filter', () => {
  // These fixtures have no regex rules and must not initialise external lists.
  before(() => {
    mock.method(RegexAccess, 'isRegexAllowed', async () => false);
  });
  after(() => mock.restoreAll());
  it('does not reject a real title when metadata only has a numbered placeholder', async () => {
    const { titles } = selectEpisodeTitles('imdbId', '2005-03-29', [
      source('Episode 2', '2005-03-29'),
    ]);
    assert.deepEqual(
      await filterTitles({ titles, candidates: ['Diversity Day'] }),
      ['Diversity Day']
    );
  });
  it('does not use a matching placeholder to establish ambiguous show identity', async () => {
    const { titles } = selectEpisodeTitles('imdbId', '2005-03-29', [
      source('Episode 2', '2005-03-29'),
    ]);
    assert.deepEqual(
      await filterTitles({
        titles,
        candidates: ['Episode 2'],
        ambiguous: true,
      }),
      []
    );
  });
  it('keeps Don’t Look but rejects Do No Harm with agreeing metadata', async () => {
    const expected = source("Don't Look", '2016-04-02');
    const { titles } = selectEpisodeTitles('imdbId', expected.airDate, [
      expected,
      expected,
    ]);
    assert.deepEqual(
      await filterTitles({ titles, candidates: ["Don't Look", 'Do No Harm'] }),
      ["Don't Look"]
    );
  });
  it('preserves same-name show confirmation despite agreeing-title date drift, even with episode filtering off', async () => {
    const expected = source('Diversity Day', '2005-03-29');
    const { titles } = selectEpisodeTitles('imdbId', expected.airDate, [
      expected,
      source('Diversity Day', '2005-04-02'),
    ]);
    assert.deepEqual(
      await filterTitles({
        show: 'The Office',
        titles,
        candidates: ['Diversity Day', 'Work Experience'],
        ambiguous: true,
        enabled: false,
      }),
      ['Diversity Day']
    );
  });
  it('does not use titles from ambiguous ordering to positively identify a same-name show', async () => {
    const expected = source('Diversity Day', '2005-03-29');
    const { titles } = selectEpisodeTitles('imdbId', expected.airDate, [
      expected,
      source('Work Experience', '2001-07-16'),
    ]);
    assert.deepEqual(
      await filterTitles({
        show: 'The Office',
        titles,
        candidates: ['Diversity Day', 'Work Experience'],
        ambiguous: true,
        enabled: false,
      }),
      []
    );
  });
  it('makes Tak title filtering inconclusive without claiming either candidate is correct', async () => {
    const { titles } = selectEpisodeTitles('imdbId', '2007-10-13', [
      source("Zaria's in Charge", '2007-10-13'),
      source('The Littlest Gratch/Lok, the Offender', '2008-01-12'),
    ]);
    assert.deepEqual(
      await filterTitles({
        titles,
        candidates: ['The Littlest Gratch/Lok, the Offender', 'HebDub'],
      }),
      ['The Littlest Gratch/Lok, the Offender', 'HebDub']
    );
  });
  for (const enabled of [true, false]) {
    it(`preserves Office German titles and rejects unrelated episodes with episode matching ${enabled ? 'on' : 'off'}`, async () => {
      const referenceDate = '2001-01-31T22:00:00.000Z';
      const tmdb = {
        airDate: '2005-03-29',
        titles: [
          { title: 'Diversity Day' },
          { title: 'Tag der Vielfalt', language: 'de' },
        ],
      };
      const { titles } = selectEpisodeTitles(
        'imdbId',
        referenceDate,
        [tmdb, source('Diversity Day', '2005-03-29')],
        source('Diversity Day', referenceDate)
      );
      assert.deepEqual(
        await filterTitles({
          show: 'The Office',
          titles,
          candidates: ['Tag der Vielfalt', 'The Wake'],
          languages: ['German'],
          ambiguous: true,
          enabled,
        }),
        ['Tag der Vielfalt']
      );
    });
  }
  it('keeps an entity-encoded matching title at threshold 1, while rejecting Do No Harm', async () => {
    assert.deepEqual(
      await filterTitles({
        titles: [{ title: "Don't Look", language: 'en' }],
        candidates: [
          'Adventure.Time.S08E02.Don&#039;t.Look.1080p.WEBRip.AAC.x264-NTb',
          'Adventure.Time.S08E02.Do.No.Harm.1080p.WEBRip.AAC.x264-NTb',
        ],
        parseFilenames: true,
        threshold: 1,
      }),
      ["Don't Look"]
    );
  });
  for (const provider of ['kitsuId', 'malId', 'imdbId']) {
    it(`keeps a known series subtitle before the Bleach episode title for ${provider}`, async () => {
      assert.deepEqual(
        await filterTitles({
          show: 'Bleach',
          aliases: ['BLEACH: Thousand-Year Blood War - The Calamity'],
          provider,
          titles: [{ title: 'SON OF DARKNESS', language: 'en' }],
          candidates: [
            'Bleach.S17E42.Thousand-Year.Blood.War.SON.OF.DARKNESS.1080p.WEB-DL.AAC2.0.H.264-NTb.mkv',
            'Bleach.S17E42.Thousand-Year.Blood.War.THE.FIRE.1080p.WEB-DL.AAC2.0.H.264-NTb.mkv',
            'Bleach.S17E42.Unrelated.Prefix.SON.OF.DARKNESS.1080p.WEB-DL.AAC2.0.H.264-NTb.mkv',
          ],
          parseFilenames: true,
          threshold: 1,
        }),
        ['Thousand-Year Blood War SON OF DARKNESS']
      );
    });
  }
});
