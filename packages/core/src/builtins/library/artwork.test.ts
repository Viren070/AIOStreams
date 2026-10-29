import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import '../../utils/index.js';
import { parseTorrentTitle } from '@viren070/parse-torrent-title';
import { buildArtworkQuery, pickArtworkMatch } from './artwork.js';
import type { IMDBSearchResult } from '../../metadata/imdb.js';

const result = (
  id: string,
  title: string,
  year: number | undefined,
  kind: string,
  poster: string | undefined = `https://m.media-amazon.com/${id}.jpg`
): IMDBSearchResult => ({ id, title, year, kind, poster });

const queryFor = (name: string) => {
  const parsed = parseTorrentTitle(name);
  return buildArtworkQuery(parsed, parsed.title ?? name);
};

describe('buildArtworkQuery', () => {
  it('treats season/episode releases as series', () => {
    assert.deepEqual(queryFor('Rick.and.Morty.S09E04.1080p.WEB.h264-ETHEL'), {
      title: 'Rick and Morty',
      year: undefined,
      type: 'series',
    });
  });

  it('treats plain releases as movies and keeps the year', () => {
    assert.deepEqual(
      queryFor('The.Whisper.Man.2026.2160p.NF.WEB-DL.DDP5.1.Atmos.H265-FLUX'),
      { title: 'The Whisper Man', year: 2026, type: 'movie' }
    );
  });

  it('returns undefined without a title', () => {
    assert.equal(buildArtworkQuery(parseTorrentTitle(''), ''), undefined);
  });
});

describe('pickArtworkMatch', () => {
  const sexAndTheCity = [
    result('tt0159206', 'Sex and the City', 1998, 'tvSeries'),
    result('tt1000774', 'Sex and the City', 2008, 'movie'),
    result('tt1261945', 'Sex and the City 2', 2010, 'movie'),
  ];

  it('picks the series for a series release', () => {
    const match = pickArtworkMatch(sexAndTheCity, {
      title: 'Sex and the City',
      year: 1998,
      type: 'series',
    });
    assert.equal(match?.id, 'tt0159206');
  });

  it('picks the movie for a movie release', () => {
    const match = pickArtworkMatch(sexAndTheCity, {
      title: 'Sex and the City',
      year: 2008,
      type: 'movie',
    });
    assert.equal(match?.id, 'tt1000774');
  });

  it('uses the year to tell movies with the same title apart', () => {
    const mayday = [
      result('tt28014327', 'Mayday', 2026, 'movie'),
      result('tt11271800', 'Mayday', 2021, 'movie'),
    ];
    assert.equal(
      pickArtworkMatch(mayday, { title: 'Mayday', year: 2021, type: 'movie' })
        ?.id,
      'tt11271800'
    );
    assert.equal(
      pickArtworkMatch(mayday, { title: 'Mayday', year: 2015, type: 'movie' }),
      undefined
    );
  });

  it('accepts a series that started before the year in the release name', () => {
    const match = pickArtworkMatch(
      [result('tt2861424', 'Rick and Morty', 2013, 'tvSeries')],
      { title: 'Rick and Morty', year: 2023, type: 'series' }
    );
    assert.equal(match?.id, 'tt2861424');
  });

  it('matches titles that differ only in punctuation', () => {
    const match = pickArtworkMatch(
      [result('tt0491603', 'H2O: Just Add Water', 2006, 'tvSeries')],
      { title: 'H2O Just Add Water', type: 'series' }
    );
    assert.equal(match?.id, 'tt0491603');
  });

  it('rejects unrelated titles, wrong kinds and results without a poster', () => {
    assert.equal(
      pickArtworkMatch(
        [
          result('tt21064770', 'Rick and Morty: C-132', 2021, 'short'),
          result('tt1', 'Something Else Entirely', 2013, 'tvSeries'),
          {
            ...result('tt2861424', 'Rick and Morty', 2013, 'tvSeries'),
            poster: undefined,
          },
        ],
        { title: 'Rick and Morty', type: 'series' }
      ),
      undefined
    );
  });

  it('keeps the first (most relevant) result on equal scores', () => {
    const match = pickArtworkMatch(
      [
        result('tt28014327', 'Mayday', 2026, 'movie'),
        result('tt11271800', 'Mayday', 2021, 'movie'),
      ],
      { title: 'Mayday', type: 'movie' }
    );
    assert.equal(match?.id, 'tt28014327');
  });
});
