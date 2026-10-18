import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseTorrentTitle } from '@viren070/parse-torrent-title';
import { parseTorrentTitleCached } from './title.js';
import FileParser from './file.js';

const logged =
  'Naruto.SD.Rock.Lee.no.seishun.Full-Power.ninden.E34.MULTi.1080p.WEB.H264-AMB3R';
describe('SD inside a series title', () => {
  it('preserves the logged full title, episode and release metadata', () => {
    for (const name of [logged, `${logged}.mkv`]) {
      const parsed = parseTorrentTitleCached(name);
      assert.equal(
        parsed.title,
        'Naruto SD Rock Lee no seishun Full-Power ninden'
      );
      assert.deepEqual(parsed.episodes, [34]);
      assert.equal(parsed.quality, 'WEB');
      assert.equal(parsed.group, 'AMB3R');
      assert.deepEqual(parsed.languages, ['multi audio']);
      assert.equal(parsed.resolution, '1080p');
      assert.equal(FileParser.parse(name).title, parsed.title);
      assert.strictEqual(parseTorrentTitleCached(name), parsed);
    }
  });

  it('recognises other multiword series titles and explicit episode formats', () => {
    for (const marker of ['E34', 'S01E34', '1x34', 'E034']) {
      for (const separator of ['.', '_', ' ']) {
        const name =
          `[Group] Example SD Another Adventure ${marker} 1080p.mkv`.replaceAll(
            ' ',
            separator
          );
        const parsed = parseTorrentTitleCached(name);
        assert.equal(parsed.title, 'Example SD Another Adventure', name);
        assert.deepEqual(parsed.episodes, [34], name);
      }
    }
    assert.equal(
      parseTorrentTitleCached('SD.Gundam.Force.E34.mkv').title,
      'SD Gundam Force'
    );
  });

  it('preserves genuine quality tags and technical, language and edition labels', () => {
    for (const name of [
      'Example.SD.E34.mkv',
      'Example.SD.Dual.Audio.E34.mkv',
      'Example.SD.FRENCH.SUBFRENCH.E34.mkv',
      'Example.SD.English.Japanese.E34.mkv',
      'Example.SD.Remastered.Restored.E34.mkv',
      'Example.SD.1080p.WEB.H264.E34.mkv',
      'Example.SDTV.Other.Adventure.E34.mkv',
      'Example.[SD].Other.Adventure.E34.mkv',
      'Example.E34.SD.Other.Adventure.mkv',
      'Example.SD.Other.Adventure.34.mkv',
      'Example.SD.Other.Adventure.2002.1080p.mkv',
      'Example.SD.Other.Adventure.E34-E35.mkv',
    ])
      assert.deepEqual(
        parseTorrentTitleCached(name),
        parseTorrentTitle(name),
        name
      );
  });

  it('retains a genuine SD quality tag after the episode marker', () => {
    const name = 'Example.SD.Another.Adventure.E34.SD.mkv';
    const parsed = parseTorrentTitleCached(name);
    assert.equal(parsed.title, 'Example SD Another Adventure');
    assert.equal(parsed.quality, 'SDTV');
    assert.deepEqual(parsed.episodes, [34]);
  });

  it('preserves separated SDTV quality tags before an episode', () => {
    for (const separator of ['-', ' ', '.', '_']) {
      for (const quality of ['SD', 'sd']) {
        const name = `Example.${quality}${separator}TV.Other.Adventure.E34.mkv`;
        const parsed = parseTorrentTitleCached(name);
        assert.equal(parsed.title, 'Example', name);
        assert.equal(parsed.quality, 'SDTV', name);
        assert.deepEqual(parsed.episodes, [34], name);
        assert.deepEqual(parsed, parseTorrentTitle(name), name);
      }
    }
  });
});
