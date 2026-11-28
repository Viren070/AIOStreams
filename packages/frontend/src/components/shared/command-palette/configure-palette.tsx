import { useDeferredValue, useMemo, useState } from 'react';
import {
  CommandGroup,
  CommandItem,
  CommandShortcut,
} from '@aiostreams/ui/command';
import { useCommandPalette } from '@/context/command-palette';
import { useMenu } from '@/context/menu';
import { PAGES, filterTabPage } from '@/lib/configure-pages';
import { useQuickActions } from '@/context/quick-actions';
import {
  FIELD_META,
  type FilterTabId,
} from '../../../../../core/src/utils/fieldMeta';
import { buildHaystack, parseQuery, scoreItem } from './scoring';
import { CommandPaletteShell, type CommandPaletteResult } from './shell';
import { BiFilterAlt } from 'react-icons/bi';

const FILTER_TABS: Array<{ id: FilterTabId; label: string }> = [
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

function humanize(value: string): string {
  return value.replace(/-/g, ' ');
}

/** The FIELD_META index never changes, so normalise it once at module load
 *  rather than on every keystroke. */
const FIELD_ITEMS = Object.entries(FIELD_META)
  .filter(([, meta]) => !meta.ignoreForCommandPalette)
  .map(([key, meta]) => {
    const page = PAGES[meta.page].title;
    return {
      key,
      label: meta.label,
      trail:
        meta.page === 'filters' && meta.filterTab
          ? `${page} → ${humanize(meta.filterTab)}`
          : page,
      page: meta.page,
      tab: meta.filterTab,
      sectionId: meta.sectionId ?? key,
      fallbackSectionIds: meta.filterTab
        ? [`filter-tab-${meta.filterTab}`]
        : undefined,
      haystack: buildHaystack([
        meta.label,
        key,
        page,
        meta.filterTab,
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
  const { pages, setPage } = useMenu();
  const { actions: quickActions } = useQuickActions();
  const [query, setQuery] = useState('');
  // Keeps typing responsive while the (much larger) result list renders at a
  // lower priority.
  const deferredQuery = useDeferredValue(query);
  const isIdle = deferredQuery.trim().length === 0;

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

    for (const page of pages) {
      const { title } = PAGES[page];
      const score = scoreItem(buildHaystack([title, page]), q);
      if (score > 0) {
        results.push({
          id: `page-${page}`,
          label: title,
          trail: 'Page',
          score,
          onSelect: () => {
            setQuery('');
            close();
            setPage(page);
          },
        });
      }
    }

    for (const tab of FILTER_TAB_ITEMS) {
      const score = scoreItem(tab.haystack, q);
      if (score > 0) {
        results.push({
          id: `filter-tab-${tab.id}`,
          label: `${PAGES[filterTabPage(tab.id)].title} → ${tab.label}`,
          trail: 'Filter Tab',
          icon: <BiFilterAlt />,
          score,
          onSelect: () => {
            setQuery('');
            navigate({
              page: filterTabPage(tab.id),
              tab: tab.id,
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
              page: field.page,
              tab: field.tab,
              sectionId: field.sectionId,
              fallbackSectionIds: field.fallbackSectionIds,
            });
          },
        });
      }
    }

    return results.sort((a, b) => b.score - a.score);
  }, [
    deferredQuery,
    isIdle,
    quickActionItems,
    navigate,
    close,
    pages,
    setPage,
  ]);

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
