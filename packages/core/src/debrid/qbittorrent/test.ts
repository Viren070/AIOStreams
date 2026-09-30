import { toUrlSafeBase64 } from '../../utils/index.js';
import {
  parseQbittorrentCredential,
  QBittorrentClient,
  QbittorrentCredential,
} from './client.js';

export interface QbittorrentTestResult {
  ok: boolean;
  stage: 'url' | 'login' | 'api';
  error?: { message: string };
  version?: string;
  torrentCount?: number;
}

/**
 * Probe a qBittorrent WebUI for the config UI's test button: validate the
 * URL, log in (the client's first request establishes the session), and
 * list the torrents AIOStreams added, which also proves API access.
 */
export async function testQbittorrentConnection(args: {
  url: string;
  username: string;
  password: string;
}): Promise<QbittorrentTestResult> {
  let credential: QbittorrentCredential;
  try {
    credential = parseQbittorrentCredential(
      toUrlSafeBase64(JSON.stringify(args))
    );
  } catch {
    return {
      ok: false,
      stage: 'url',
      error: { message: 'That does not look like a valid WebUI URL' },
    };
  }
  const client = new QBittorrentClient(credential);
  try {
    // One call covers login (session establishment) and API access.
    const torrents = await client.getTaggedTorrents();
    return {
      ok: true,
      stage: 'api',
      torrentCount: torrents.length,
    };
  } catch (error) {
    return {
      ok: false,
      stage: 'login',
      error: {
        message:
          error instanceof Error
            ? error.message
            : 'Could not reach the qBittorrent WebUI',
      },
    };
  }
}
