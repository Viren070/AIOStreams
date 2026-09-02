export const DOCS_BASE_URL = 'https://docs.aiostreams.viren070.me';
export const DOCS_CHANGELOG_URL = `${DOCS_BASE_URL}/changelog`;

export type ReleaseChannel = 'stable' | 'nightly' | 'dev';

export interface GithubRelease {
  id: number;
  tag_name: string;
  published_at: string;
  html_url: string;
  body: string | null;
}

/** One hand-written entry from the docs changelog, newest first. */
export interface DocsChangelogEntry {
  version: string | null;
  title: string;
  description: string | null;
  date: string;
  url: string;
}

/**
 * Compare two version tags of the same channel.
 * Returns >0 when `a` is newer than `b`.
 */
export function compareVersions(
  a: string,
  b: string,
  channel: ReleaseChannel
): number {
  if (channel === 'stable') {
    const av = a.replace(/^v/, '').split('.').map(Number);
    const bv = b.replace(/^v/, '').split('.').map(Number);
    for (let i = 0; i < Math.max(av.length, bv.length); i++) {
      const l = av[i] || 0;
      const r = bv[i] || 0;
      if (l > r) return 1;
      if (l < r) return -1;
    }
    return 0;
  }
  // Nightly tags are timestamps, so a string compare is already chronological.
  const an = a.replace('-nightly', '');
  const bn = b.replace('-nightly', '');
  return an > bn ? 1 : an < bn ? -1 : 0;
}

export function releaseMatchesChannel(
  tag: string,
  channel: ReleaseChannel
): boolean {
  return channel === 'stable'
    ? tag.startsWith('v') && !tag.includes('nightly')
    : tag.endsWith('-nightly');
}

export type VersionJump = 'major' | 'minor' | 'patch';

/**
 * How big a step it is from `from` to `to`, or null if it is not a step
 * forward. Only stable semver tags can be classified.
 */
export function versionJump(from: string, to: string): VersionJump | null {
  const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number);
  const [fMajor, fMinor, fPatch] = parse(from);
  const [tMajor, tMinor, tPatch] = parse(to);
  if ([fMajor, fMinor, fPatch, tMajor, tMinor, tPatch].some(Number.isNaN)) {
    return null;
  }
  if (tMajor > fMajor) return 'major';
  if (tMajor < fMajor) return null;
  if (tMinor > fMinor) return 'minor';
  if (tMinor < fMinor) return null;
  if (tPatch > fPatch) return 'patch';
  return null;
}

/** `v2.33.1` -> `2.33`, the key the docs changelog is written against. */
export function minorKey(version: string): string {
  const [major, minor] = version.replace(/^v/, '').split('.');
  return `${major}.${minor}`;
}

export function findDocsEntry(
  entries: DocsChangelogEntry[],
  version: string
): DocsChangelogEntry | undefined {
  const key = minorKey(version);
  return entries.find(
    (entry) => entry.version && minorKey(entry.version) === key
  );
}

export function docsEntryUrl(entry: DocsChangelogEntry): string {
  return entry.url.startsWith('http')
    ? entry.url
    : `${DOCS_BASE_URL}${entry.url}`;
}

/**
 * The hand-written changelog. One small static JSON from the docs CDN, rather
 * than a hundred release bodies from the GitHub API.
 */
export async function fetchDocsChangelog(): Promise<DocsChangelogEntry[]> {
  const response = await fetch(`${DOCS_BASE_URL}/api/changelog.json`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  return Array.isArray(data) ? (data as DocsChangelogEntry[]) : [];
}

const GITHUB_RELEASES_URL =
  'https://api.github.com/repos/viren070/aiostreams/releases';

export interface ReleasePage {
  releases: GithubRelease[];
  hasNextPage: boolean;
}

/**
 * One page of releases, unfiltered. Nightlies vastly outnumber stable tags, so
 * a page of 100 can hold only a handful of the channel the caller wants — the
 * caller pages until it has enough rather than assuming one page is enough.
 */
export async function fetchReleasePage(page: number): Promise<ReleasePage> {
  const response = await fetch(
    `${GITHUB_RELEASES_URL}?per_page=100&page=${page}`
  );
  if (!response.ok) {
    throw new Error(
      response.status === 403
        ? 'GitHub rate limit reached. Try again in a little while.'
        : `HTTP ${response.status}`
    );
  }
  const releases = (await response.json()) as GithubRelease[];
  const link = response.headers.get('link');
  return { releases, hasNextPage: !!link && link.includes('rel="next"') };
}

const LAST_SEEN_KEY = 'aiostreams-last-seen-version';

export function getLastSeenVersion(): string | null {
  try {
    return localStorage.getItem(LAST_SEEN_KEY);
  } catch {
    return null;
  }
}

export function setLastSeenVersion(version: string): void {
  try {
    localStorage.setItem(LAST_SEEN_KEY, version);
  } catch {
    // Private mode or blocked storage; the notice simply shows again.
  }
}
