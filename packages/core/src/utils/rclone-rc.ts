import { createLogger } from '../logging/logger.js';
import { makeRequest } from './http.js';
import { config as appConfig } from '../config/index.js';
import { onShareInvalidation } from '../shares/invalidation.js';

const logger = createLogger('rclone');

/**
 * Nudge an rclone mount to forget what it thinks the library looks like.
 * The mount answers listings from its own cache for `--dir-cache-time`, so
 * a download that just finished is invisible to Sonarr/Radarr until that
 * expires, and a job we retired lingers just as long. Optional: with no
 * remote control configured this does nothing.
 */
const TIMEOUT_MS = 5_000;

/** Coalesce the burst of library changes an import produces into one call. */
const DEBOUNCE_MS = 2_000;
let pending: NodeJS.Timeout | undefined;
const pendingDirs = new Set<string>();

function rcConfig(): { url: string; auth?: string } | undefined {
  const { rcUrl, rcUser, rcPass } = appConfig.shares.rclone;
  const url = rcUrl.trim().replace(/\/$/, '');
  if (!url) return undefined;
  const auth = rcUser
    ? Buffer.from(`${rcUser}:${rcPass}`).toString('base64')
    : undefined;
  return { url, auth };
}

async function post(
  command: string,
  body: Record<string, unknown>
): Promise<void> {
  const rc = rcConfig();
  if (!rc) return;
  const res = await makeRequest(`${rc.url}/${command}`, {
    method: 'POST',
    timeout: TIMEOUT_MS,
    ignoreRecursion: true,
    headers: {
      'Content-Type': 'application/json',
      ...(rc.auth ? { Authorization: `Basic ${rc.auth}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`rclone ${command} → ${res.status}`);
  }
}

/**
 * Forget then refresh the given directories. Forget alone would leave the next
 * listing to a cold lookup; refresh alone can be served from the very cache we
 * are trying to invalidate.
 */
async function flush(dirs: string[]): Promise<void> {
  for (const dir of dirs) {
    await post('vfs/forget', { dir });
  }
  for (const dir of dirs) {
    await post('vfs/refresh', { dir, recursive: 'false' });
  }
}

/** Queue an invalidation for a directory path within the mount. */
export function refreshRcloneDir(...dirs: string[]): void {
  if (!rcConfig()) return;
  for (const dir of dirs) pendingDirs.add(dir.replace(/^\/+/, ''));
  if (pending) return;
  pending = setTimeout(() => {
    pending = undefined;
    const batch = [...pendingDirs];
    pendingDirs.clear();
    void flush(batch).catch((err) =>
      logger.debug(
        { err: (err as Error)?.message },
        'could not refresh the rclone mount; it will catch up on its own'
      )
    );
  }, DEBOUNCE_MS);
  pending.unref?.();
}

// The tree says what changed; only an rclone mount needs telling over HTTP,
// and only when its remote control was configured.
onShareInvalidation((event) => {
  if (!rcConfig()) return;
  refreshRcloneDir(...(event.type === 'dirs' ? event.dirs : [event.dir]));
});
