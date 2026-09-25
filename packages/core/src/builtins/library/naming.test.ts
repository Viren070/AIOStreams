import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import '../../utils/index.js';
import { parseTorrentTitle } from '@viren070/parse-torrent-title';
import { formatLibraryItemName } from './naming.js';

const name = (release: string, matched?: { title?: string; year?: number }) =>
  formatLibraryItemName(parseTorrentTitle(release), release, matched);

describe('formatLibraryItemName', () => {
  it('formats single episodes', () => {
    assert.equal(
      name('Rick.and.Morty.S09E04.A.Rick.in.Time.1080p.WEB.h264-ETHEL'),
      'Rick and Morty S09E04'
    );
  });

  it('drops site prefixes the parser strips', () => {
    assert.equal(
      name('www.UIndex.org    -    Rick and Morty S09E02 1080p WEB h264-ETHEL'),
      'Rick and Morty S09E02'
    );
  });

  it('formats season packs and season ranges', () => {
    assert.equal(
      name('H2O.Just.Add.Water.S02.1080p.WEB-DL'),
      'H2O Just Add Water S02'
    );
    assert.equal(
      name('Sex.And.The.City.S01-S06.2160p.MAX.WEB-DL'),
      'Sex And The City S01-S06'
    );
  });

  it('labels complete series without season numbers', () => {
    assert.equal(
      name('Sex.and.the.City.Complete.Series.1080p.BluRay'),
      'Sex and the City Complete'
    );
  });

  it('adds the year for movies', () => {
    assert.equal(name('Mayday.2026.2160p.ATVP.WEB-DL.DDP5.1'), 'Mayday (2026)');
  });

  it('prefers the matched title and falls back to the matched year', () => {
    assert.equal(
      name('H2O.Just.Add.Water.S02.1080p.WEB-DL', {
        title: 'H2O: Just Add Water',
        year: 2006,
      }),
      'H2O: Just Add Water S02'
    );
    assert.equal(
      name('Some.Movie.1080p.WEB-DL', { title: 'Some Movie', year: 2019 }),
      'Some Movie (2019)'
    );
  });
});
