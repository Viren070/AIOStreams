import { it } from 'node:test';
import assert from 'node:assert/strict';
import { release, seriesContext } from '../../test/title-fixtures.js';
import { initialiseTestSettings, mockHttp } from '../../test/helpers.js';
import StreamFilterer from './filterer.js';
import { RegexAccess } from '../utils/regex-access.js';
import type { Metadata } from '../metadata/utils.js';
import type { UserData } from '../db/schemas.js';

const original =
  'Naruto.S01E34.Akamaru.Trembles.Gaaras.Cruel.Strength.1080p.Dual.Audio.HEVC.10bit.x265.AAC.mkv';
const spinoff =
  'Naruto.SD.Rock.Lee.no.seishun.Full-Power.ninden.E34.MULTi.1080p.WEB.H264-AMB3R.mkv';
it('keeps the full series identity for Usenet, torrent and direct results', async (t) => {
  await initialiseTestSettings(t);
  mockHttp(t);
  t.mock.method(RegexAccess, 'isRegexAllowed', async () => false);
  const options = {
    titleMatching: {
      enabled: true,
      mode: 'exact',
      similarityThreshold: 0.96,
      ambiguousResults: 'discard',
    },
  } as UserData;
  const metadata: Metadata = {
    title: 'Naruto',
    titles: [{ title: 'Naruto' }],
    absoluteEpisode: 34,
  };
  const context = (data: Metadata) =>
    seriesContext(data, {
      id: 'tt0409591:1:34',
      isAnime: true,
      parsedId: {
        type: 'imdbId',
        value: 'tt0409591',
        season: '1',
        episode: '34',
      },
    });
  for (const type of ['usenet', 'p2p', 'http'] as const) {
    for (const idMatched of [false, true]) {
      const streams = [original, spinoff].map((name) =>
        release(name, { type, idMatched })
      );
      const kept = await new StreamFilterer(options).filter(
        streams,
        context(metadata)
      );
      assert.deepEqual(
        kept.map((s) => s.filename),
        [original],
        `${type} ID match ${idMatched}`
      );
    }
  }
  const fullTitle = 'Naruto SD Rock Lee no seishun Full-Power ninden';
  const own = await new StreamFilterer(options).filter(
    [release(original), release(spinoff)],
    context({
      title: fullTitle,
      titles: [{ title: fullTitle }],
      absoluteEpisode: 34,
    })
  );
  assert.deepEqual(
    own.map((s) => s.filename),
    [spinoff]
  );
  const disabled = await new StreamFilterer({
    ...options,
    titleMatching: { enabled: false },
  } as UserData).filter([release(spinoff)], context(metadata));
  assert.equal(disabled.length, 1);
});
