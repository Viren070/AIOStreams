import {
  FIELD_META,
  PAGE_IDS,
  type FilterTabId,
  type PageId,
} from '../../../core/src/utils/fieldMeta';

export type { PageId };

/** Pages with grid-sized editors take the full width. */
export const WIDE_PAGES: readonly PageId[] = [
  'home',
  'addons',
  'catalogs',
  'formatter',
  'stats',
];

export const PAGES: Record<PageId, { title: string; description: string }> = {
  home: {
    title: 'Home',
    description: 'Get started, templates and what is new.',
  },
  services: {
    title: 'Services',
    description:
      'Your debrid, usenet and metadata accounts, and how streams use them.',
  },
  addons: {
    title: 'Addons',
    description: 'The addons streams come from, and how they are fetched.',
  },
  catalogs: {
    title: 'Catalogs',
    description: 'What you browse, and the posters it shows.',
  },
  filters: {
    title: 'Filters',
    description: 'Which streams are kept, preferred or removed.',
  },
  results: {
    title: 'Results',
    description:
      'How the streams that are left get sorted, merged and capped, and what else the list shows.',
  },
  formatter: {
    title: 'Formatter',
    description: 'How each stream is named and described.',
  },
  playback: {
    title: 'Playback',
    description:
      'Proxying, preloading, what happens when you press play and what plays next.',
  },
  app: {
    title: 'Setup',
    description:
      'Get the app, sign in on your devices, and choose what the apps get.',
  },
  profiles: {
    title: 'Profiles',
    description:
      'Everyone who watches in the apps, with their own history and trackers.',
  },
  stremio: {
    title: 'Stremio',
    description: 'Install it, and keep it updated.',
  },
  'other-apps': {
    title: 'Other apps',
    description: 'Jellyfin apps, Seanime, Chillio, Aniyomi and APIs.',
  },
  configuration: {
    title: 'Configuration',
    description: 'Name, password, backups and this page itself.',
  },
  advanced: {
    title: 'Advanced',
    description: 'Parent configs, variants and health checks.',
  },
  stats: {
    title: 'Stats',
    description: 'What your addons and services have returned.',
  },
};

export const PAGE_GROUPS: { label?: string; pages: PageId[] }[] = [
  { pages: ['home'] },
  { label: 'Sources', pages: ['services', 'addons', 'catalogs'] },
  { label: 'Streams', pages: ['filters', 'results', 'formatter', 'playback'] },
  { label: 'AIOStreams app', pages: ['app', 'profiles'] },
  { label: 'Install', pages: ['stremio', 'other-apps'] },
  { label: 'Manage', pages: ['configuration', 'advanced', 'stats'] },
];

const RESULTS_FILTER_TABS: readonly FilterTabId[] = ['limit', 'deduplicator'];

export const filterTabPage = (tab: FilterTabId): PageId =>
  RESULTS_FILTER_TABS.includes(tab) ? 'results' : 'filters';

export function pageOfField(field: string): PageId | undefined {
  return (
    FIELD_META as Partial<
      Record<string, (typeof FIELD_META)[keyof typeof FIELD_META]>
    >
  )[field]?.page;
}

export function isPageId(value: unknown): value is PageId {
  return (PAGE_IDS as readonly unknown[]).includes(value);
}
