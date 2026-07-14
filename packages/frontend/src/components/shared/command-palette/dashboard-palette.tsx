import React, { useDeferredValue, useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { BiCog } from 'react-icons/bi';
import { NAV, SECTIONED } from '@/app/dashboard/nav';
import { TAB_MANIFEST } from '@/app/dashboard/settings/tabs.config';
import {
  useSettings,
  type SettingsKey,
} from '@/app/dashboard/settings/queries';
import { useUsenetSettings } from '@/app/dashboard/usenet/queries';
import { useDashboardCommandPalette } from '@/context/dashboard-command-palette';
import { buildHaystack, parseQuery, scoreItem, type Haystack } from './scoring';
import { CommandPaletteShell, type CommandPaletteResult } from './shell';

/** Usenet engine settings are hidden from the generic settings page, so they resolve to a different route. */
const USENET_SECTION = 'usenet';

type Target =
  | { kind: 'page'; href: string }
  | { kind: 'settings'; tab: string; field?: string }
  | { kind: 'usenet-settings'; field?: string };

interface Indexed {
  id: string;
  label: string;
  trail: string;
  icon: React.ReactNode;
  target: Target;
  haystack: Haystack;
}

const STATIC_ITEMS: Indexed[] = [
  ...NAV.map((item) => ({
    id: `page-${item.href}`,
    label: item.label,
    trail: 'Page',
    icon: React.createElement(item.icon),
    target: { kind: 'page', href: item.href } as Target,
    haystack: buildHaystack([item.label, item.href]),
  })),
  ...Object.entries(SECTIONED).flatMap(([base, sections]) => {
    const parent = NAV.find((n) => n.href === base);
    return sections.map((section) => ({
      id: `section-${base}-${section.id}`,
      label: section.label,
      trail: parent?.label ?? base,
      icon: React.createElement(section.icon),
      target: { kind: 'page', href: `${base}/${section.id}` } as Target,
      haystack: buildHaystack([
        section.label,
        section.id,
        parent?.label,
        `${parent?.label} ${section.label}`,
      ]),
    }));
  }),
  ...Object.entries(TAB_MANIFEST).map(([section, def]) => ({
    id: `settings-${section}`,
    label: def.label,
    trail: 'Settings',
    icon: React.createElement(def.icon),
    target: { kind: 'settings', tab: section } as Target,
    haystack: buildHaystack([def.label, section, def.group]),
  })),
];

function indexFields(keys: SettingsKey[]): Indexed[] {
  return keys.map((k) => {
    const section = k.key.split('.')[0];
    const tabLabel = TAB_MANIFEST[section]?.label ?? section;
    return {
      id: `field-${k.key}`,
      label: k.label,
      trail:
        section === USENET_SECTION
          ? 'Usenet → Settings'
          : `Settings → ${tabLabel}`,
      icon: <BiCog />,
      target:
        section === USENET_SECTION
          ? { kind: 'usenet-settings', field: k.key }
          : { kind: 'settings', tab: section, field: k.key },
      haystack: buildHaystack(
        [k.label, k.key, k.env, ...k.key.split('.').slice(1)],
        [k.description]
      ),
    };
  });
}

export function DashboardCommandPalette() {
  const { isOpen, close } = useDashboardCommandPalette();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const isIdle = deferredQuery.trim().length === 0;

  // Only fetched once the palette is opened
  const { data: settingsData } = useSettings({ enabled: isOpen });
  const { data: usenetSettingsData } = useUsenetSettings({ enabled: isOpen });

  const fieldItems = useMemo(
    () =>
      indexFields([
        ...(settingsData?.keys ?? []),
        ...(usenetSettingsData?.keys ?? []),
      ]),
    [settingsData?.keys, usenetSettingsData?.keys]
  );

  const go = (target: Target) => {
    close();
    setQuery('');
    switch (target.kind) {
      case 'page':
        navigate({ to: target.href });
        break;
      case 'settings':
        // the page scrolls itself to the field.
        navigate({
          to: '/dashboard/settings',
          search: { tab: target.tab, field: target.field },
          resetScroll: false,
        });
        break;
      case 'usenet-settings':
        navigate({
          to: '/dashboard/usenet/settings',
          search: { field: target.field },
          resetScroll: false,
        });
        break;
    }
  };

  const searchResults = useMemo((): CommandPaletteResult[] => {
    if (isIdle) return [];
    const q = parseQuery(deferredQuery);
    const results: CommandPaletteResult[] = [];

    for (const item of [...STATIC_ITEMS, ...fieldItems]) {
      const score = scoreItem(item.haystack, q);
      if (score > 0) {
        results.push({
          id: item.id,
          label: item.label,
          trail: item.trail,
          icon: item.icon,
          score,
          onSelect: () => go(item.target),
        });
      }
    }

    return results.sort((a, b) => b.score - a.score);
  }, [deferredQuery, isIdle, fieldItems]);

  return (
    <CommandPaletteShell
      open={isOpen}
      onClose={() => {
        close();
        setQuery('');
      }}
      label="Dashboard search"
      placeholder="Search dashboard pages, sections, settings…"
      emptyHint="Enter a page or section to search for…"
      query={query}
      onQueryChange={setQuery}
      isIdle={isIdle}
      results={searchResults}
    />
  );
}
