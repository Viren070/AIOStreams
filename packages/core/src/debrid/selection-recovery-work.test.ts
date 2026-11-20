import '../parser/utils.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { selectFileInTorrentOrNZB } from './utils.js';
import { parseTorrentTitleCached } from '../parser/title.js';
import type { DebridDownload, TitleMetadata } from './base.js';
import type { NZB, Torrent } from './utils.js';

describe('file selection recovery work', () => {
  for (const type of ['usenet', 'torrent'] as const) {
    for (const mediaType of ['movie', 'series'] as const) {
      for (const withFiles of [false, true]) {
        it(`${type} ${mediaType}: recovery only visits its own names (${withFiles ? 'with files' : 'without files'})`, async () => {
          const title =
            mediaType === 'movie' ? 'Harbour Mystery 30' : 'Harbour Adventure';
          const release =
            mediaType === 'movie'
              ? '[Group] Harbour Mystery 30 (1080p).mkv'
              : '[Group] Harbour Adventure 110 1080p.mkv';
          const filename = release.replace('1080p', '720p');
          const titles = [title];
          let aliasVisits = 0;
          Object.defineProperty(titles, Symbol.iterator, {
            value: function* () {
              aliasVisits++;
              yield title;
            },
          });
          const metadata: TitleMetadata = {
            mediaType,
            titles,
            isAnime: true,
            ...(mediaType === 'series'
              ? { episode: 110, absoluteEpisode: 110 }
              : {}),
          };
          const parsed = new Map(
            [
              release,
              filename,
              ...Array.from(
                { length: 100 },
                (_, i) => `[Group] Unrelated Adventure ${i + 1} 720p.mkv`
              ),
            ].map((name) => [name, parseTorrentTitleCached(name)])
          );
          const snapshot = structuredClone(parsed);
          const item = {
            type,
            title: release,
            hash: 'test',
            size: 100000000,
            nzb: 'https://example.com/test.nzb',
            sources: [],
          } as NZB | Torrent;
          const download = {
            status: 'cached',
            files: withFiles
              ? [{ name: filename, size: 100000000, index: 0 }]
              : undefined,
          } as DebridDownload;
          const selected = await selectFileInTorrentOrNZB(
            item,
            download,
            parsed,
            metadata
          );
          assert.equal(selected?.name, withFiles ? filename : release);
          const recoveryEnabled = mediaType === 'movie' || type === 'usenet';
          assert.equal(aliasVisits, withFiles && recoveryEnabled ? 2 : 0);
          assert.deepEqual(parsed, snapshot);
        });
      }
    }
  }
});
