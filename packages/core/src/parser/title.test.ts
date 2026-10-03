import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { decodeReleaseName, parseTorrentTitleCached } from './title.js';

const release = (title: string) =>
  `Adventure.Time.S08E02.${title}.1080p.WEBRip.AAC.x264-NTb`;

describe('indexer episode names', () => {
  it('decodes an encoded episode title without losing technical fields', () => {
    const parsed = parseTorrentTitleCached(release('Don&#039;t.Look'));
    assert.equal(parsed.title, 'Adventure Time');
    assert.equal(parsed.episodeTitle, "Don't Look");
    assert.equal(parsed.group, 'NTb');
    assert.deepEqual(parsed.seasons, [8]);
    assert.deepEqual(parsed.episodes, [2]);
    assert.equal(parsed.resolution, '1080p');
    assert.equal(parsed.codec, 'x264');
    assert.deepEqual(parsed.audio, ['AAC']);
  });
  it('preserves a genuinely different episode title', () => {
    assert.equal(
      parseTorrentTitleCached(release('Do.No.Harm')).episodeTitle,
      'Do No Harm'
    );
  });
  it('decodes apostrophes in multiple representations before parsing', () => {
    for (const apostrophe of ['&#039;', '&#x27;', '&#X27;', '&apos;', "'"]) {
      assert.equal(
        parseTorrentTitleCached(release(`Don${apostrophe}t.Look`)).episodeTitle,
        "Don't Look"
      );
    }
  });
  it('does not strip an arbitrary trailing episode-title word', () => {
    assert.equal(
      parseTorrentTitleCached(
        'Adventure.Time.S08E02.Do.No.Harm.1080p.WEBRip.x264'
      ).episodeTitle,
      'Do No Harm'
    );
    assert.equal(
      parseTorrentTitleCached('Example.S01E01.Dont.Look.Back.1080p.WEBRip.x264')
        .episodeTitle,
      'Dont Look Back'
    );
  });
  it('preserves normal trailing release-group syntax', () => {
    const parsed = parseTorrentTitleCached(
      "Adventure.Time.S08E02.Don't.Look.1080p.WEBRip.x264-NTb"
    );
    assert.equal(parsed.episodeTitle, "Don't Look");
    assert.equal(parsed.group, 'NTb');
  });
  it('decodes once and preserves unknown or invalid entities', () => {
    assert.equal(
      decodeReleaseName(
        'A&amp;B &amp;#039; &unknown; &#x110000; &#0; &#xD800;'
      ),
      'A&B &#039; &unknown; &#x110000; &#0; &#xD800;'
    );
  });
  it('returns a consistent cached parse', () => {
    assert.strictEqual(
      parseTorrentTitleCached(release('Don&#039;t.Look')),
      parseTorrentTitleCached(release('Don&#039;t.Look'))
    );
  });
});
