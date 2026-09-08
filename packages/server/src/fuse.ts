import path from 'node:path';
import {
  mountSharedFilesystem,
  probeFuse,
  type FuseMount,
  type FuseMountStats,
} from '@viren070/fsmux-fuse';
import {
  config as appConfig,
  createLogger,
  onShareInvalidation,
  shareFilesystem,
  subscribeToConfig,
} from '@aiostreams/core';

const logger = createLogger('fuse');

export type FuseMountState =
  | 'off'
  | 'unavailable'
  | 'mounting'
  | 'mounted'
  | 'unmounted'
  | 'error';

/** What the status panel shows: runtime state a toggle cannot express. */
export interface FuseStatus {
  enabled: boolean;
  state: FuseMountState;
  mountPath: string;
  allowOther: boolean;
  /** This host could mount at all (binding, /dev/fuse, capability). */
  available: boolean;
  reason?: string;
  error?: string;
  since?: number;
  stats?: FuseMountStats;
  arrMountDir: string;
}

let mount: FuseMount | undefined;
let state: FuseMountState = 'off';
let reason: string | undefined;
let lastError: string | undefined;
let since: number | undefined;
let unsubscribeInvalidation: (() => void) | undefined;
let watching = false;
let queue: Promise<unknown> = Promise.resolve();

/** Mount and unmount never overlap, whoever asks. */
function serialize<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work, work);
  queue = run.catch(() => undefined);
  return run;
}

export function fuseStatus(): FuseStatus {
  const cfg = appConfig.shares;
  return {
    enabled: cfg.fuse.enabled,
    state,
    mountPath: cfg.fuse.mountPath,
    allowOther: cfg.fuse.allowOther,
    available: state !== 'unavailable',
    reason,
    error: lastError,
    since,
    stats: mount?.stats(),
    arrMountDir: appConfig.arr.mountDir,
  };
}

function warnMountDirMismatch(mountPath: string): void {
  const arrDir = appConfig.arr.mountDir.trim();
  if (!arrDir) {
    logger.warn(
      { mountPath },
      'arr.mountDir is empty: set it to the path the arr sees the mount at, or imports cannot resolve symlinks'
    );
  } else if (path.posix.normalize(arrDir) !== path.posix.normalize(mountPath)) {
    logger.info(
      { mountPath, arrMountDir: arrDir },
      'arr.mountDir differs from the FUSE mount path; fine only if the arr container binds the mount elsewhere'
    );
  }
}

function watchConfig(): void {
  if (watching) return;
  watching = true;
  subscribeToConfig(({ changed }) => {
    const relevant = [...changed].some((key) => key.startsWith('shares.fuse.'));
    if (!relevant) return;
    void stopFuseMount()
      .then(() => startFuseMount())
      .catch((err) =>
        logger.error({ err }, 'fuse remount after settings change failed')
      );
  });
}

async function doStart(): Promise<void> {
  watchConfig();
  const cfg = appConfig.shares;
  if (!cfg.fuse.enabled) {
    state = 'off';
    reason = undefined;
    return;
  }
  if (mount) return;
  const probe = await probeFuse({ allowOther: cfg.fuse.allowOther });
  if (!probe.ok) {
    state = 'unavailable';
    reason = probe.reason;
    logger.warn({ reason: probe.reason }, 'fuse mount unavailable');
    return;
  }
  state = 'mounting';
  reason = undefined;
  try {
    const mounted = await mountSharedFilesystem({
      mountPath: cfg.fuse.mountPath,
      fs: shareFilesystem({ owner: cfg.fuse.owner, scope: 'library' }),
      allowOther: cfg.fuse.allowOther,
      logger,
    });
    mount = mounted;
    unsubscribeInvalidation = onShareInvalidation((event) => {
      if (event.type === 'dirs') {
        for (const dir of event.dirs) mounted.invalidateDir(dir);
      } else {
        mounted.invalidateEntry(event.dir, event.name);
      }
    });
    state = 'mounted';
    since = Date.now();
    lastError = undefined;
    warnMountDirMismatch(cfg.fuse.mountPath);
  } catch (err) {
    mount = undefined;
    state = 'error';
    lastError = err instanceof Error ? err.message : String(err);
    logger.error({ err }, 'fuse mount failed');
  }
}

async function doStop(): Promise<void> {
  unsubscribeInvalidation?.();
  unsubscribeInvalidation = undefined;
  const current = mount;
  mount = undefined;
  since = undefined;
  if (current) {
    try {
      await current.unmount();
    } catch (err) {
      logger.warn({ err }, 'fuse unmount failed');
    }
  }
  state = appConfig.shares.fuse.enabled ? 'unmounted' : 'off';
}

/** Mount when the mode says so; a no-op otherwise. Safe to call repeatedly. */
export function startFuseMount(): Promise<FuseStatus> {
  return serialize(async () => {
    await doStart();
    return fuseStatus();
  });
}

export function stopFuseMount(): Promise<FuseStatus> {
  return serialize(async () => {
    await doStop();
    return fuseStatus();
  });
}
