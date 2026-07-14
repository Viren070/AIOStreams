import React, { useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command/command';
import { useDashboardCommandPalette } from '@/context/dashboard-command-palette';
import {
  BiBarChartAlt2,
  BiListUl,
  BiServer,
  BiCog,
  BiNetworkChart,
  BiGridAlt,
  BiGroup,
  BiTask,
  BiData,
  BiCloudDownload,
  BiBlock,
  BiLibrary,
  BiMoviePlay,
  BiBarChartAlt,
  BiCloudUpload,
  BiRss,
} from 'react-icons/bi';
import { TAB_MANIFEST } from '@/app/dashboard/settings/tabs.config';
import { useSettings } from '@/app/dashboard/settings/queries';
import type { SettingsKey } from '@/app/dashboard/settings/queries';
import { useUsenetSettings } from '@/app/dashboard/usenet/queries';

// ── Page definitions ──────────────────────────────────────────────────────

interface PageItem {
  id: string;
  label: string;
  trail: string;
  icon: React.ReactNode;
  href?: string;
  /** Settings tab param, e.g. `?tab=api`. Only applicable when parent is settings. */
  tab?: string;
  /** Individual setting field key, e.g. `usenet.lazyRarResolution`, to scroll to. */
  field?: string;
  keywords?: string[];
}

const PAGE_ICONS: Record<string, React.ReactNode> = {
  overview: <BiGridAlt />,
  analytics: <BiBarChartAlt2 />,
  logs: <BiListUl />,
  system: <BiServer />,
  users: <BiGroup />,
  tasks: <BiTask />,
  cache: <BiData />,
  usenet: <BiCloudDownload />,
  blocklist: <BiBlock />,
  proxy: <BiNetworkChart />,
  settings: <BiCog />,
};

const SUBSECTION_ICONS: Record<string, React.ReactNode> = {
  library: <BiLibrary />,
  streams: <BiMoviePlay />,
  stats: <BiBarChartAlt />,
  providers: <BiServer />,
  sources: <BiRss />,
  entries: <BiListUl />,
  publishing: <BiCloudUpload />,
};

const DASHBOARD_PAGES: PageItem[] = [
  { id: 'overview', label: 'Overview', trail: 'Page', icon: PAGE_ICONS.overview, href: '/dashboard' },
  { id: 'analytics', label: 'Analytics', trail: 'Page', icon: PAGE_ICONS.analytics, href: '/dashboard/analytics' },
  { id: 'logs', label: 'Logs', trail: 'Page', icon: PAGE_ICONS.logs, href: '/dashboard/logs' },
  { id: 'system', label: 'System', trail: 'Page', icon: PAGE_ICONS.system, href: '/dashboard/system' },
  { id: 'users', label: 'Users', trail: 'Page', icon: PAGE_ICONS.users, href: '/dashboard/users' },
  { id: 'tasks', label: 'Tasks', trail: 'Page', icon: PAGE_ICONS.tasks, href: '/dashboard/tasks' },
  { id: 'cache', label: 'Cache', trail: 'Page', icon: PAGE_ICONS.cache, href: '/dashboard/cache' },
  { id: 'proxy', label: 'Proxy', trail: 'Page', icon: PAGE_ICONS.proxy, href: '/dashboard/proxy' },
  // Settings is last because it has sub-entries
  { id: 'settings', label: 'Settings', trail: 'Page', icon: PAGE_ICONS.settings, href: '/dashboard/settings' },
];

// Sub-sections appear as Usenet → Library, Blocklist → Sources, etc.
const SUBSECTIONS: PageItem[] = [
  { id: 'usenet-library', label: 'Usenet → Library', trail: 'Usenet', icon: SUBSECTION_ICONS.library, href: '/dashboard/usenet/library', keywords: ['usenet library'] },
  { id: 'usenet-streams', label: 'Usenet → Streams', trail: 'Usenet', icon: SUBSECTION_ICONS.streams, href: '/dashboard/usenet/streams', keywords: ['usenet streams', 'usenet downloads'] },
  { id: 'usenet-stats', label: 'Usenet → Stats', trail: 'Usenet', icon: SUBSECTION_ICONS.stats, href: '/dashboard/usenet/stats', keywords: ['usenet statistics'] },
  { id: 'usenet-providers', label: 'Usenet → Providers', trail: 'Usenet', icon: SUBSECTION_ICONS.providers, href: '/dashboard/usenet/providers', keywords: ['usenet servers'] },
  { id: 'usenet-settings', label: 'Usenet → Settings', trail: 'Usenet', icon: <BiCog />, href: '/dashboard/usenet/settings', keywords: ['usenet config'] },
  { id: 'blocklist-sources', label: 'Blocklist → Sources', trail: 'Blocklist', icon: SUBSECTION_ICONS.sources, href: '/dashboard/blocklist/sources' },
  { id: 'blocklist-entries', label: 'Blocklist → Entries', trail: 'Blocklist', icon: SUBSECTION_ICONS.entries, href: '/dashboard/blocklist/entries' },
  { id: 'blocklist-publishing', label: 'Blocklist → Publishing', trail: 'Blocklist', icon: SUBSECTION_ICONS.publishing, href: '/dashboard/blocklist/publishing', keywords: ['blocklist publish', 'blocklist export'] },
];

// Settings sub-tabs (from TAB_MANIFEST)
const SETTINGS_TABS: PageItem[] = Object.entries(TAB_MANIFEST).map(
  ([section, def]) => ({
    id: `settings-${section}`,
    label: `Settings → ${def.label}`,
    trail: 'Settings',
    icon: React.createElement(def.icon),
    tab: section,
    href: `/dashboard/settings?tab=${section}`,
    keywords: [def.label, section, def.group],
  })
);

// ── Individual setting fields (fetched from API) ─────────────────────────

function buildFieldItems(keys: SettingsKey[]): PageItem[] {
  return keys.map((k) => {
    const section = k.key.split('.')[0];
    const tabLabel = TAB_MANIFEST[section]?.label ?? section;
    return {
      id: `field-${k.key}`,
      label: k.label,
      trail: `Settings → ${tabLabel}`,
      icon: <BiCog />,
      tab: section,
      field: k.key,
      keywords: [
        k.label,
        k.key,
        k.env ?? '',
        k.description.slice(0, 80),
        ...k.key.split('.').slice(1), // individual path segments, e.g. lazyRarResolution
        k.label.toLowerCase().replace(/[^a-z0-9]/g, ' '), // "lazy rar resolution" for fuzzy
      ].filter(Boolean),
    };
  });
}

const ALL_ITEMS = [...DASHBOARD_PAGES, ...SUBSECTIONS, ...SETTINGS_TABS];

// ── Scoring ──────────────────────────────────────────────────────────────

function scoreMatch(text: string, query: string): number {
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  if (!q || !t) return 0;
  if (t === q) return 100;
  if (t.startsWith(q)) return 90;
  if (t.includes(q)) return 75;
  const words = t.split(/[\s\-_/]+/);
  if (words.some((w) => w.startsWith(q))) return 65;
  if (words.some((w) => w.includes(q))) return 55;
  // fuzzy: all query chars appear in order
  let qi = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) qi++;
  }
  if (qi === q.length) return 10 + Math.floor((q.length / t.length) * 30);
  return 0;
}

function bestScore(
  candidates: Array<string | undefined | null>,
  query: string
): number {
  let best = 0;
  for (const c of candidates) {
    if (!c) continue;
    const s = scoreMatch(c, query);
    if (s > best) best = s;
  }
  return best;
}

type SearchResult = {
  id: string;
  label: string;
  trail: string;
  icon?: React.ReactNode;
  score: number;
  href?: string;
  tab?: string;
  field?: string;
};

// ── Component ────────────────────────────────────────────────────────────

export function DashboardCommandPalette() {
  const { isOpen, close } = useDashboardCommandPalette();
  const [query, setQuery] = useState('');
  const isEmpty = query.trim().length === 0;
  const navigate = useNavigate();

  // Fetch all settings keys so we can search individual fields too
  const { data: settingsData } = useSettings();
  const { data: usenetSettingsData } = useUsenetSettings();
  const settingsKeys = settingsData?.keys ?? [];
  const usenetKeys = usenetSettingsData?.keys ?? [];
  // Merge usenet engine settings into the main search index (they are hidden
  // from the generic settings page because they have their own editor).
  const allKeys = useMemo(
    () => [...settingsKeys, ...usenetKeys],
    [settingsKeys, usenetKeys]
  );

  const searchResults = useMemo((): SearchResult[] => {
    if (isEmpty) return [];
    const q = query.trim();
    const results: SearchResult[] = [];

    // Static items (pages, subsections, settings tabs)
    for (const item of ALL_ITEMS) {
      const score = bestScore(
        [item.label, item.id, ...(item.keywords ?? [])],
        q
      );
      if (score > 0) {
        results.push({
          id: item.id,
          label: item.label,
          trail: item.trail,
          icon: item.icon,
          score,
          href: item.href,
          tab: item.tab,
        });
      }
    }

    // Individual setting fields (only searchable when settings data is loaded)
    const fieldItems = buildFieldItems(allKeys);
    for (const item of fieldItems) {
      const score = bestScore(
        [item.label, item.id, ...(item.keywords ?? [])],
        q
      );
      if (score > 0) {
        results.push({
          id: item.id,
          label: item.label,
          trail: item.trail,
          icon: item.icon,
          score,
          tab: item.tab,
          field: item.field,
        });
      }
    }

    return results.sort((a, b) => b.score - a.score);
  }, [query, isEmpty, allKeys]);

  const handleSelect = (result: SearchResult) => {
    close();
    setQuery('');
    if (result.tab) {
      // Usenet engine settings are hidden from the generic settings page and
      // live on their own dedicated page — navigate there instead.
      if (result.tab === 'usenet') {
        navigate({
          to: '/dashboard/usenet/settings' as any,
          replace: true,
          search: result.field
            ? ({ field: result.field } as any)
            : undefined,
        });
      } else {
        navigate({
          to: '/dashboard/settings' as any,
          search: {
            tab: result.tab,
            field: result.field ?? undefined,
          } as any,
        });
      }
    } else if (result.href) {
      navigate({ to: result.href as any });
    }
  };

  return (
    <CommandDialog
      open={isOpen}
      onOpenChange={(v) => {
        if (!v) {
          close();
          setQuery('');
        }
      }}
      hideCloseButton
      contentClass="max-w-2xl p-0"
      commandProps={{ shouldFilter: false, label: 'Dashboard search' }}
    >
      <CommandInput
        placeholder="Search dashboard pages, sections, settings…"
        autoFocus
        value={query}
        onValueChange={setQuery}
      />
      <CommandList className="max-h-[60vh]">
        <CommandEmpty>
          {isEmpty
            ? 'Enter a page or section to search for…'
            : 'No matches.'}
        </CommandEmpty>

        {!isEmpty && (
          <CommandGroup>
            {searchResults.map((result) => (
              <CommandItem
                key={result.id}
                value={result.id}
                leftIcon={result.icon}
                onSelect={() => handleSelect(result)}
              >
                <span>{result.label}</span>
                <span className="ml-auto text-xs text-[--muted] capitalize">
                  {result.trail}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
