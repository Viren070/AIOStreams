import { createLogger } from '../logging/logger.js';
import { config, settingsStore } from '../config/index.js';
import { ReleaseBlocklistRepository } from '../db/repositories/release-blocklist.js';
import { toNativeNdjson } from './io.js';
import { LOCAL_SOURCE_ID } from './types.js';

const logger = createLogger('release-blocklist');

const GIST_FILENAME = 'blocklist.ndjson';
const GIST_API = 'https://api.github.com/gists';
const REQUEST_TIMEOUT_MS = 15_000;

/** Extract the gist id (32 hex) from a stored gist URL or a bare id. Takes the
 *  last hex run so an owner segment in the path cannot shadow the id. */
function gistIdFrom(urlOrId: string): string | null {
  const matches = urlOrId.match(/[0-9a-f]{20,}/gi);
  return matches ? matches[matches.length - 1] : null;
}

async function githubRequest(
  token: string,
  method: 'POST' | 'PATCH',
  path: string,
  body: unknown
): Promise<{ id: string; ownerLogin: string }> {
  const res = await fetch(`${GIST_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'aiostreams',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const err = new Error(
      `GitHub gist ${method} failed (${res.status}): ${detail}`
    );
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  const json = (await res.json()) as { id: string; owner?: { login?: string } };
  return { id: json.id, ownerLogin: json.owner?.login ?? '' };
}

/**
 * Publish this instance's own verdicts to a secret GitHub gist and return its
 * raw URL. Creates the gist on first use and updates it in place afterwards;
 * the auto-created URL is written back to settings so it stays stable.
 */
export async function publishBlocklistGist(): Promise<string> {
  const settings = config.releaseBlocklist;
  const token = settings.githubToken.trim();
  if (!token) throw new Error('no GitHub token configured');

  const records = await ReleaseBlocklistRepository.getEntries([
    LOCAL_SOURCE_ID,
  ]);
  const content = toNativeNdjson(records);
  const files = { [GIST_FILENAME]: { content } };
  const create = () =>
    githubRequest(token, 'POST', '', {
      description: 'AIOStreams release blocklist',
      public: false,
      files,
    });
  const existingId = gistIdFrom(settings.githubGistUrl);

  let id: string;
  let ownerLogin: string;
  if (existingId) {
    try {
      ({ id, ownerLogin } = await githubRequest(
        token,
        'PATCH',
        `/${existingId}`,
        { files }
      ));
    } catch (err) {
      // The gist was deleted upstream: create a fresh one instead of failing
      // every sync until the stale URL is cleared by hand.
      if ((err as { status?: number }).status !== 404) throw err;
      ({ id, ownerLogin } = await create());
    }
  } else {
    ({ id, ownerLogin } = await create());
  }

  const url = `https://gist.githubusercontent.com/${ownerLogin}/${id}/raw/${GIST_FILENAME}`;
  if (url !== settings.githubGistUrl) {
    await settingsStore.set('releaseBlocklist.githubGistUrl', url);
  }
  logger.info(`published blocklist to gist (${records.length} verdicts)`);
  return url;
}

let lastSyncedRevision: string | null = null;

/**
 * Push to the gist only when the exported list has changed since the last
 * push. Safe to call on every refresh tick; a no-op when sharing is off.
 */
export async function syncBlocklistGist(): Promise<void> {
  if (!config.releaseBlocklist.githubToken.trim()) return;
  const revision = await ReleaseBlocklistRepository.getExportRevision('local');
  if (revision === lastSyncedRevision) return;
  await publishBlocklistGist();
  lastSyncedRevision = revision;
}
