'use client';

import React, { useMemo, useState } from 'react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@/components/ui/command/command';
import { useCommandPalette } from '@/context/command-palette';
import { useQuickActions } from '@/context/quick-actions';
import { useMode } from '@/context/mode';
import { FIELD_META, type MenuId } from '../../../../core/src/utils/fieldMeta';
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
} from 'react-icons/bi';

const MENU_ITEMS: Array<{
  id: MenuId;
  label: string;
  icon: React.ReactNode;
  proOnly?: boolean;
}> = [
  { id: 'about', label: 'About', icon: <BiInfoCircle /> },
  { id: 'services', label: 'Services', icon: <BiCloud /> },
  { id: 'addons', label: 'Addons', icon: <BiExtension /> },
  { id: 'filters', label: 'Filters', icon: <BiFilterAlt /> },
  { id: 'sorting', label: 'Sorting', icon: <BiSort />, proOnly: true },
  { id: 'formatter', label: 'Formatter', icon: <BiPen /> },
  { id: 'proxy', label: 'Proxy', icon: <BiServer /> },
  { id: 'miscellaneous', label: 'Miscellaneous', icon: <BiCog /> },
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
  fun: 'Options',
  filters: 'Filters',
  sorting: 'Sorting',
  formatter: 'Formatter',
  proxy: 'Proxy',
  miscellaneous: 'Miscellaneous',
  'save-install': 'Save & Install',
};

function humanize(value: string): string {
  return value.replace(/-/g, ' ');
}

// Returns 0–100. Higher = better match.
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
  shortcut?: string;
  onSelect: () => void;
};

export function CommandPalette() {
  const { isOpen, close, navigate } = useCommandPalette();
  const { actions: quickActions } = useQuickActions();
  const { mode } = useMode();
  const [query, setQuery] = useState('');
  const isEmpty = query.trim().length === 0;

  const visibleMenus = useMemo(
    () => MENU_ITEMS.filter((m) => mode === 'pro' || !m.proOnly),
    [mode]
  );

  const searchResults = useMemo((): SearchResult[] => {
    if (isEmpty) return [];
    const q = query.trim();
    const results: SearchResult[] = [];

    for (const action of quickActions) {
      const score = bestScore(
        [action.label, action.description, ...(action.keywords ?? [])],
        q
      );
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
      const score = bestScore([menu.label, menu.id], q);
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

    for (const tab of FILTER_TABS) {
      const score = bestScore(['filter tab', tab.label, tab.id], q);
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

    for (const [key, meta] of Object.entries(FIELD_META) as Array<
      [string, (typeof FIELD_META)[keyof typeof FIELD_META]]
    >) {
      const score = bestScore(
        [meta.label, key, meta.menu, meta.subTab, ...(meta.keywords ?? [])],
        q
      );
      if (score > 0) {
        const trail =
          meta.subTab !== undefined
            ? `${humanize(meta.menu)} → ${humanize(meta.subTab)}`
            : (MENU_LABELS[meta.menu] ?? humanize(meta.menu));
        const sectionId = meta.sectionId ?? key;
        const fallbacks: string[] = [];
        if (meta.menu === 'filters' && meta.subTab) {
          fallbacks.push(`filter-tab-${meta.subTab}`);
        }
        results.push({
          id: key,
          label: meta.label,
          trail,
          score,
          onSelect: () => {
            setQuery('');
            navigate({
              menu: meta.menu,
              subTab: meta.subTab,
              sectionId,
              fallbackSectionIds: fallbacks,
            });
          },
        });
      }
    }

    return results.sort((a, b) => b.score - a.score);
  }, [query, isEmpty, quickActions, visibleMenus, navigate, close]);

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
      commandProps={{ shouldFilter: false, label: 'Settings search' }}
    >
      <CommandInput
        placeholder="Search settings, pages, actions…"
        autoFocus
        value={query}
        onValueChange={setQuery}
      />
      <CommandList className="max-h-[60vh]">
        <CommandEmpty>
          {isEmpty ? 'Enter a setting to search for…' : 'No matches.'}
        </CommandEmpty>

        {isEmpty && quickActions.length > 0 && (
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
        )}

        {!isEmpty && (
          <CommandGroup>
            {searchResults.map((result) => (
              <CommandItem
                key={result.id}
                value={result.id}
                leftIcon={result.icon}
                onSelect={result.onSelect}
              >
                <span>{result.label}</span>
                <span className="ml-auto text-xs text-[--muted] capitalize">
                  {result.trail}
                </span>
                {result.shortcut && (
                  <CommandShortcut>{result.shortcut}</CommandShortcut>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
