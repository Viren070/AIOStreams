import React, { useDeferredValue, useMemo, useState } from 'react';
import {
  CommandGroup,
  CommandItem,
  CommandShortcut,
} from '@/components/ui/command/command';
import { useCommandPalette } from '@/context/command-palette';
import { useQuickActions } from '@/context/quick-actions';
import { useMode } from '@/context/mode';
import { useStatus } from '@/context/status';
import { useUserData } from '@/context/userData';
import {
  FIELD_META,
  type MenuId,
} from '../../../../../core/src/utils/fieldMeta';
import { buildHaystack, parseQuery, scoreItem } from './scoring';
import { CommandPaletteShell, type CommandPaletteResult } from './shell';
import {
  BiInfoCircle,
  BiCloud,
  BiExtension,
  BiFilterAlt,
  BiSort,
  BiPen,
  BiServer,
  BiCog,
  BiSave,
  BiBarChartAlt2,
} from 'react-icons/bi';

const MENU_ITEMS: Array<{
  id: MenuId;
  label: string;
  icon: React.ReactNode;
  proOnly?: boolean;
  /** When true, the entry is only shown if (a) the instance owner has
   *  per-user analytics on, and (b) the user is signed in. */
  requiresStats?: boolean;
}> = [
  { id: 'about', label: 'About', icon: <BiInfoCircle /> },
  { id: 'services', label: 'Services', icon: <BiCloud /> },
  { id: 'addons', label: 'Addons', icon: <BiExtension /> },
  { id: 'filters', label: 'Filters', icon: <BiFilterAlt /> },
  { id: 'sorting', label: 'Sorting', icon: <BiSort />, proOnly: true },
  { id: 'formatter', label: 'Formatter', icon: <BiPen /> },
  { id: 'proxy', label: 'Proxy', icon: <BiServer /> },
  { id: 'miscellaneous', label: 'Miscellaneous', icon: <BiCog /> },
  {
    id: 'stats',
    label: 'Stats',
    icon: <BiBarChartAlt2 />,
    requiresStats: true,
  },
  { id: 'save-install', label: 'Save & Install', icon: <BiSave /> },
];

const FILTER_TABS: Array<{ id: string; label: string }> = [
  { id: 'cache', label: 'Cache' },
  { id: 'resolution', label: 'Resolution' },
  { id: 'quality', label: 'Quality' },
  { id: 'encode', label: 'Encode' },
  { id: 'stream-type', label: 'Stream Type' },
  { id: 'visual-tag', label: 'Visual Tag' },
  { id: 'audio-tag', label: 'Audio Tag' },
  { id: 'audio-channel', label: 'Audio Channel' },
  { id: 'language', label: 'Language' },
  { id: 'subtitle', label: 'Subtitle' },
  { id: 'seeders', label: 'Seeders' },
  { id: 'age', label: 'Age' },
  { id: 'matching', label: 'Matching' },
  { id: 'keyword', label: 'Keyword' },
  { id: 'release-group', label: 'Release Group' },
  { id: 'stream-expression', label: 'Stream Expression' },
  { id: 'regex', label: 'Regex' },
  { id: 'size', label: 'Size' },
  { id: 'bitrate', label: 'Bitrate' },
  { id: 'limit', label: 'Result Limits' },
  { id: 'deduplicator', label: 'Deduplicator' },
  { id: 'miscellaneous', label: 'Miscellaneous (Filters)' },
];

const MENU_LABELS: Record<MenuId, string> = {
  about: 'About',
  services: 'Services',
  addons: 'Addons',
  filters: 'Filters',
  sorting: 'Sorting',
  stats: 'Stats',
  formatter: 'Formatter',
  proxy: 'Proxy',
  miscellaneous: 'Miscellaneous',
  'save-install': 'Save & Install',
};

function humanize(value: string): string {
  return value.replace(/-/g, ' ');
}

/** The FIELD_META index never changes, so normalise it once at module load
 *  rather than on every keystroke. */
const FIELD_ITEMS = Object.entries(FIELD_META).map(([key, meta]) => {
  const trail =
    meta.subTab !== undefined
      ? `${humanize(meta.menu)} → ${humanize(meta.subTab)}`
      : (MENU_LABELS[meta.menu] ?? humanize(meta.menu));
  const fallbackSectionIds =
    meta.menu === 'filters' && meta.subTab
      ? [`filter-tab-${meta.subTab}`]
      : undefined;
  return {
    key,
    label: meta.label,
    trail,
    sectionId: meta.sectionId ?? key,
    menu: meta.menu,
    subTab: meta.subTab,
    fallbackSectionIds,
    haystack: buildHaystack([
      meta.label,
      key,
      meta.menu,
      meta.subTab,
      ...(meta.keywords ?? []),
    ]),
  };
});

const FILTER_TAB_ITEMS = FILTER_TABS.map((tab) => ({
  ...tab,
  haystack: buildHaystack(['filter tab', tab.label, tab.id]),
}));

export function CommandPalette() {
  const { isOpen, close, navigate } = useCommandPalette();
  const { actions: quickActions } = useQuickActions();
  const { mode } = useMode();
  const { status } = useStatus();
  const user = useUserData();
  const statsAvailable =
    status?.settings.userAnalyticsEnabled === true &&
    Boolean(user.uuid && user.password);
  const [query, setQuery] = useState('');
  // Keeps typing responsive while the (much larger) result list renders at a
  // lower priority.
  const deferredQuery = useDeferredValue(query);
  const isIdle = deferredQuery.trim().length === 0;

  const visibleMenus = useMemo(
    () =>
      MENU_ITEMS.filter(
        (m) =>
          (mode === 'pro' || !m.proOnly) && (!m.requiresStats || statsAvailable)
      ).map((m) => ({ ...m, haystack: buildHaystack([m.label, m.id]) })),
    [mode, statsAvailable]
  );

  const quickActionItems = useMemo(
    () =>
      quickActions.map((action) => ({
        action,
        haystack: buildHaystack(
          [action.label, ...(action.keywords ?? [])],
          [action.description]
        ),
      })),
    [quickActions]
  );

  const searchResults = useMemo((): CommandPaletteResult[] => {
    if (isIdle) return [];
    const q = parseQuery(deferredQuery);
    const results: CommandPaletteResult[] = [];

    for (const { action, haystack } of quickActionItems) {
      const score = scoreItem(haystack, q);
      if (score > 0) {
        results.push({
          id: `action-${action.id}`,
          label: action.label,
          trail: 'Action',
          icon: action.icon,
          score,
          shortcut: action.shortcut,
          onSelect: () => {
            close();
            setQuery('');
            action.onSelect();
          },
        });
      }
    }

    for (const menu of visibleMenus) {
      const score = scoreItem(menu.haystack, q);
      if (score > 0) {
        results.push({
          id: `menu-${menu.id}`,
          label: menu.label,
          trail: 'Page',
          icon: menu.icon,
          score,
          onSelect: () => {
            setQuery('');
            navigate({ menu: menu.id });
          },
        });
      }
    }

    for (const tab of FILTER_TAB_ITEMS) {
      const score = scoreItem(tab.haystack, q);
      if (score > 0) {
        results.push({
          id: `filter-tab-${tab.id}`,
          label: `Filters → ${tab.label}`,
          trail: 'Filter Tab',
          icon: <BiFilterAlt />,
          score,
          onSelect: () => {
            setQuery('');
            navigate({
              menu: 'filters',
              subTab: tab.id,
              sectionId: `filter-tab-${tab.id}`,
            });
          },
        });
      }
    }

    for (const field of FIELD_ITEMS) {
      const score = scoreItem(field.haystack, q);
      if (score > 0) {
        results.push({
          id: field.key,
          label: field.label,
          trail: field.trail,
          score,
          onSelect: () => {
            setQuery('');
            navigate({
              menu: field.menu,
              subTab: field.subTab,
              sectionId: field.sectionId,
              fallbackSectionIds: field.fallbackSectionIds,
            });
          },
        });
      }
    }

    return results.sort((a, b) => b.score - a.score);
  }, [deferredQuery, isIdle, quickActionItems, visibleMenus, navigate, close]);

  return (
    <CommandPaletteShell
      open={isOpen}
      onClose={() => {
        close();
        setQuery('');
      }}
      label="Settings search"
      placeholder="Search settings, pages, actions…"
      emptyHint="Enter a setting to search for…"
      query={query}
      onQueryChange={setQuery}
      isIdle={isIdle}
      results={searchResults}
      idleGroup={
        quickActions.length > 0 && (
          <CommandGroup heading="Quick actions">
            {quickActions.map((action) => (
              <CommandItem
                key={action.id}
                value={`action-${action.id}`}
                leftIcon={action.icon}
                onSelect={() => {
                  close();
                  setQuery('');
                  action.onSelect();
                }}
              >
                <span>{action.label}</span>
                {action.shortcut && (
                  <CommandShortcut>{action.shortcut}</CommandShortcut>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        )
      }
    />
  );
}
