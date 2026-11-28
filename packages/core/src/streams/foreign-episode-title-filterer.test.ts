import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import FileParser from '../parser/file.js';
import { IdParser } from '../utils/id-parser.js';
import StreamFilterer from './filterer.js';
import type { ParsedStream, UserData } from '../db/schemas.js';
import type { StreamContext } from './context.js';

const REQUEST = 'tt0417299:1:1';
const TITLE = 'The Boy in the Iceberg';

async function keepEpisode(
  filename: string,
  episodeTitles: Array<{ title: string; language: string }>
): Promise<boolean> {
  const stream = {
    id: filename,
    filename,
    type: 'torrent',
    size: 500_000_000,
    parsedFile: FileParser.parse(filename),
    addon: {
      instanceId: 'test-addon',
      resultPassthrough: false,
      preset: { id: 'test-addon', type: 'torrentio' },
    },
  } as unknown as ParsedStream;

  const config = {
    uuid: 'unit-test',
    titleMatching: { enabled: false },
    yearMatching: { enabled: false },
    seasonEpisodeMatching: { enabled: false },
    episodeTitleMatching: {
      enabled: true,
      requestTypes: ['series'],
      similarityThreshold: 0.8,
    },
    bitrate: { useMetadataRuntime: false },
  } as unknown as UserData;

  const metadata = {
    title: 'Avatar: The Last Airbender',
    titles: [{ title: 'Avatar: The Last Airbender', language: 'en' }],
    year: 2005,
    episodeTitles,
  };

  const context = {
    type: 'series',
    id: REQUEST,
    parsedId: IdParser.parse(REQUEST, 'series'),
    isAnime: false,
    getPermittedPatterns: async () => [],
    getMetadata: async () => metadata,
    getReleaseDates: async () => [],
    getEpisodeAirDate: async () => undefined,
    getEpisodeRuntime: async () => undefined,
    toExpressionContext: async () => ({}),
  } as unknown as StreamContext;

  const filter = new StreamFilterer(config);
  const accepted = await filter.filter([stream], context);
  return accepted.length === 1;
}

describe('episode title matching fallback for numbered foreign filenames', () => {
  it('rejects another season despite a matching bare episode number', async () => {
    assert.equal(
      await keepEpisode('1.Состояние Аватара (The Avatar State).mkv', [
        { title: TITLE, language: 'en' },
      ]),
      false
    );
  });

  it('rejects a mismatch with appended resolution and release tags', async () => {
    assert.equal(
      await keepEpisode('1.Состояние Аватара (The Avatar State) [1080p].mkv', [
        { title: TITLE, language: 'en' },
      ]),
      false
    );
  });

  it('keeps the expected episode in the same filename format', async () => {
    assert.equal(
      await keepEpisode('1.В айсберге (The Boy in the Iceberg).mkv', [
        { title: TITLE, language: 'en' },
      ]),
      true
    );
  });

  it('does not reject when only non-English metadata is available', async () => {
    assert.equal(
      await keepEpisode('1.Состояние Аватара (The Avatar State).mkv', [
        { title: 'Мальчик в айсберге', language: 'ru' },
      ]),
      true
    );
  });

  it('does not reject an unknown English filename format', async () => {
    assert.equal(
      await keepEpisode('Avatar.The.Last.Airbender.EP01.1080p.mkv', [
        { title: TITLE, language: 'en' },
      ]),
      true
    );
  });

  it('does not treat decorative non-ASCII symbols as foreign title evidence', async () => {
    assert.equal(
      await keepEpisode('1.Pilot™ (The Avatar State).mkv', [
        { title: TITLE, language: 'en' },
      ]),
      true
    );
  });

  it('matches a valid basename even under a long parent directory', async () => {
    assert.equal(
      await keepEpisode(
        'nested/'.repeat(40) + '1.Название (The Avatar State).mkv',
        [{ title: TITLE, language: 'en' }]
      ),
      false
    );
  });

  it('does not reject a contradictory filename if episode titles are absent', async () => {
    assert.equal(
      await keepEpisode('1.Состояние Аватара (The Avatar State).mkv', []),
      true
    );
  });
});
