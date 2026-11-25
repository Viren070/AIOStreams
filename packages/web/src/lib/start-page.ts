import { currentHost } from './hosts';
import { currentServer, sameServer } from './jellyfin/servers';
import { asksWho, stayingUser } from './jellyfin/session';
import { to } from './paths';
import { restorePoint } from './playback/restore';
import {
  holdPaused,
  holdTracks,
  plainId,
  type RemoteCommand,
} from './remote/commands';
import { settings, type StartPage } from './settings';

const PATHS: Record<StartPage, () => string> = {
  home: () => to.home,
  discover: () => to.discover(),
  live: () => to.live(),
  favourites: () => to.favourites(),
  calendar: () => to.calendar(),
  activity: () => to.history,
  downloads: () => to.downloads,
};

export function startPages(): StartPage[] {
  return Object.keys(PATHS).filter(
    (page) => page !== 'downloads' || !!currentHost().downloads
  ) as StartPage[];
}

/** Where the app opens, and where a new session starts. */
export function startPath(): string {
  const page = settings.interface.startPage.read();
  return startPages().includes(page) ? PATHS[page]() : to.home;
}

/** Before the router reads the address: an app opened on Home goes to the start page, and a link keeps its own. */
export function openStartPage(): void {
  if (/^#\/restore\/?$/.test(location.hash)) return restore();
  // Any other start: what an earlier run noted is no file to put back any more.
  restorePoint.clear();
  if (!/^#?\/?$/.test(location.hash)) return;
  const path = startPath();
  if (path !== to.home) history.replaceState(history.state, '', `#${path}`);
}

/**
 * The app's own start after Android closed it for memory with a file out of sight: straight into
 * the player's loading screen for that file as it was, over the start page that closing it goes
 * back to. A point from another server or user, or none, opens the start page as usual.
 */
function restore(): void {
  history.replaceState(entry(0), '', `#${startPath()}`);
  const point = restorePoint.take();
  const server = currentServer();
  if (!point || !server || !sameServer(point.base, server)) return;
  if (point.userId && (asksWho(server) || stayingUser(server) !== point.userId))
    return;
  const command: RemoteCommand = {
    kind: 'play',
    itemId: point.itemId,
    sourceId: plainId(point.sourceId) ?? undefined,
    startMs: point.positionMs,
    audio: point.audio,
    subtitle: point.subtitle,
    paused: point.paused,
  };
  holdTracks(command);
  holdPaused(command);
  history.pushState(
    entry(1),
    '',
    `#${to.play(point.itemId, point.sourceId, point.positionMs)}`
  );
}

/** A history entry as the router writes its own, so back goes from the player to the page under it. */
function entry(index: number) {
  const key = (Math.random() + 1).toString(36).slice(7);
  return { __TSR_index: index, key, __TSR_key: key };
}
