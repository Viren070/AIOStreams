import { afterEach, before, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
// Load the core entry point first; the debrid services import each other.
import '../../index.js';
import { settingsStore } from '../../config/index.js';
import { SettingsRepository } from '../../db/repositories/settings.js';
import { StremThruService } from '../../debrid/stremthru.js';
import type { DebridDownload, Torrent } from '../../debrid/index.js';
import { processTorrents } from './debrid.js';

const hash = (c: string) => c.repeat(40);

function torrent(c: string, title?: string, confirmed?: boolean): Torrent {
  return {
    type: 'torrent',
    hash: hash(c),
    title,
    confirmed,
    size: 1_000_000_000,
    sources: [],
  };
}

const metadata = { titles: ['Show Name'], year: 2020, season: 2, episode: 3 };

describe('processTorrents', () => {
  before(async () => {
    mock.method(SettingsRepository, 'getAll', async () => []);
    mock.method(SettingsRepository, 'getVersion', async () => 0);
    await settingsStore.initialise();
  });
  afterEach(() => mock.restoreAll());

  it('checks only the hashes that can pass validation', async () => {
    const names: Record<string, string> = {
      [hash('a')]: 'Show.Name.S02E03.1080p.WEB-DL',
      [hash('d')]: 'Show.Name.S02E03.720p.WEB-DL',
      [hash('e')]: 'Other.Name.S02E03.1080p.WEB-DL',
    };
    const checked: string[][] = [];
    mock.method(
      StremThruService.prototype,
      'checkMagnets',
      async (magnets: string[]): Promise<DebridDownload[]> => {
        checked.push(magnets);
        return magnets.map((h) => ({
          id: -1,
          hash: h,
          name: names[h],
          status: 'cached',
          size: 1_000_000_000,
          files: [{ name: `${names[h]}.mkv`, size: 1_000_000_000, index: 0 }],
        }));
      }
    );

    const { results, errors } = await processTorrents(
      [
        torrent('a', 'Show.Name.S02E03.1080p.WEB-DL'),
        torrent('b', 'Show.Name.S05E01.1080p.WEB-DL'), // another season
        torrent('c', 'Another.Film.2019.1080p.BluRay'), // another title
        torrent('d'), // untitled: passed to the check, as before
        torrent('e', 'Other.Name.S02E03.1080p.WEB-DL', true), // id-matched
      ],
      [{ id: 'realdebrid', credential: 'token' }],
      'tt0000001:2:3',
      metadata,
      undefined,
      false
    );

    assert.deepEqual(errors, []);
    assert.deepEqual(checked, [[hash('a'), hash('d'), hash('e')]]);
    assert.deepEqual(
      results.map((r) => r.hash),
      [hash('a'), hash('d'), hash('e')]
    );
  });

  it('checks every hash without metadata', async () => {
    const checked: string[][] = [];
    mock.method(
      StremThruService.prototype,
      'checkMagnets',
      async (magnets: string[]): Promise<DebridDownload[]> => {
        checked.push(magnets);
        return [];
      }
    );

    await processTorrents(
      [
        torrent('a', 'Show.Name.S02E03.1080p.WEB-DL'),
        torrent('b', 'Another.Film.2019.1080p.BluRay'),
      ],
      [{ id: 'realdebrid', credential: 'token' }],
      'tt0000001:2:3',
      undefined,
      undefined,
      false
    );

    assert.deepEqual(checked, [[hash('a'), hash('b')]]);
  });
});
