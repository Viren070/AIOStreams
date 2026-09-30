import { toUrlSafeBase64 } from '../../utils/index.js';
import { DebridError } from '../base.js';
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
 * Probe a WebUI for the config UI's test button, validate the URL, log in
 * and list our torrents, which also proves API access.
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
    // Fixed buckets only, echoing upstream status codes would turn the
    // test button into a network probe of whatever the caller pointed at.
    const status =
      error instanceof DebridError ? error.statusCode : undefined;
    const banned = error instanceof Error && error.message.includes('banned');
    return {
      ok: false,
      stage: status === 401 || status === 403 ? 'login' : 'api',
      error: {
        message: banned
          ? 'The WebUI rejected the login (the host may be banned; wait a minute and retry)'
          : status === 401 || status === 403
            ? 'Login failed: check the username and password'
            : 'Could not reach the qBittorrent WebUI at that URL',
      },
    };
  }
}
