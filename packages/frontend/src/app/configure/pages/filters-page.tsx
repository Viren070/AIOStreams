import React from 'react';
import type { FilterTabId } from '../../../../../core/src/utils/fieldMeta';
import {
  FILTER_TAB_ICONS,
  FILTER_TAB_LABELS,
  filterTabShown,
  useFilterSections,
} from '@/components/menu/filters';
import { useMode } from '@/context/mode';
import { useStatus } from '@/context/status';
import { useMenu } from '@/context/menu';
import { InheritedBadge } from '@/components/shared/inherited-badge';
import { DrillIn, RowList } from './rows';

const GROUPS: { title: string; tabs: FilterTabId[] }[] = [
  {
    title: 'Quality',
    tabs: [
      'resolution',
      'quality',
      'encode',
      'visual-tag',
      'audio-tag',
      'audio-channel',
    ],
  },
  { title: 'Language', tabs: ['language', 'subtitle'] },
  {
    title: 'Source',
    tabs: ['cache', 'stream-type', 'seeders', 'age', 'size', 'bitrate'],
  },
  {
    title: 'Rules',
    tabs: ['keyword', 'release-group', 'regex', 'stream-expression'],
  },
  { title: 'Matching', tabs: ['matching', 'miscellaneous'] },
];

const LABELS: Partial<Record<FilterTabId, string>> = {
  cache: 'Cached and uncached',
  miscellaneous: 'Release checks',
};

export const filterLabel = (tab: FilterTabId) =>
  LABELS[tab] ?? FILTER_TAB_LABELS[tab];

export function FiltersPage() {
  const { pageTab, setPage, back } = useMenu();
  const { mode } = useMode();
  const { status } = useStatus();
  const { sections, modals } = useFilterSections();
  const groups = GROUPS.map((group) => ({
    ...group,
    tabs: group.tabs.filter((tab) => filterTabShown(tab, mode, status)),
  })).filter((group) => group.tabs.length);
  const open = groups.some((g) => g.tabs.includes(pageTab as FilterTabId))
    ? (pageTab as FilterTabId)
    : null;

  return (
    <>
      {open ? (
        <DrillIn
          id={`filter-tab-${open}`}
          back="Filters"
          title={filterLabel(open)}
          onBack={back}
        >
          {sections[open]}
        </DrillIn>
      ) : (
        <>
          <InheritedBadge section="filters" />
          {groups.map((group) => (
            <RowList
              key={group.title}
              title={group.title}
              rows={group.tabs.map((tab) => ({
                id: tab,
                label: filterLabel(tab),
                icon: FILTER_TAB_ICONS[tab],
                onOpen: () => setPage('filters', tab),
              }))}
            />
          ))}
        </>
      )}
      {modals}
    </>
  );
}
