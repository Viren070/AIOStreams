import type { ParsedStream } from '../../db/schemas.js';
import { fromRemuxDbVersion, nzbIndexerGuid } from '../../remuxdb/adapter.js';
import type { MediaProbeVersion } from '../../remuxdb/client.js';
import { releaseKeyKind, torrentKey } from '../../release-blocklist/keys.js';
import { nzbUrlKey } from '../identity.js';
import { queueReport, storesFrom } from './queue.js';

/** Keep a RemuxDB version a stream matched, under keys of our own. */
export function queueRemuxDbMatch(
  stream: ParsedStream,
  version: MediaProbeVersion
): void {
  if (!storesFrom('remuxdb')) return;
  const hash = stream.torrent?.infoHash?.toLowerCase();
  let releaseKeys: string[] = [];
  let source: MediaProbeVersion['sources'][number] | undefined;
  if (hash) {
    // RemuxDB names the torrent and its file, so no addon's word is taken.
    source = version.sources.find(
      (s) => s.torrent_info_hash?.toLowerCase() === hash
    );
    const key = torrentKey(hash);
    if (key) releaseKeys = [key];
  } else if (stream.nzbUrl) {
    const { indexer, guid } =
      nzbIndexerGuid(stream.nzbUrl, stream.infoUrl) ?? {};
    source = version.sources.find(
      (s) => !!indexer && s.indexer === indexer && s.indexer_guid === guid
    );
    releaseKeys = [
      releaseKeyKind(stream.releaseKey) === 'usenet'
        ? stream.releaseKey
        : undefined,
      nzbUrlKey(stream.nzbUrl),
    ].filter((k): k is string => !!k);
  }
  const file = source?.filename;
  if (!file || releaseKeys.length === 0) return;
  queueReport(
    'remuxdb',
    `${releaseKeys[0]}/${file}`,
    version.content_hash ?? `${version.size}|${version.tracks.length}`,
    () => ({
      releaseKeys,
      file,
      size: version.size ?? undefined,
      releaseFiles: 0,
      title: stream.torrent?.title ?? stream.folderName,
      record: () => fromRemuxDbVersion(version),
    })
  );
}
