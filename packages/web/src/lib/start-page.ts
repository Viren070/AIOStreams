import { currentHost } from './hosts';
import { to } from './paths';
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
  if (!/^#?\/?$/.test(location.hash)) return;
  const path = startPath();
  if (path !== to.home) history.replaceState(history.state, '', `#${path}`);
}
