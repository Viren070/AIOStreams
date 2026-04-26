'use client';
import { useState, useEffect } from 'react';
import { PageControls } from '../shared/page-controls';
import { PageWrapper } from '../shared/page-wrapper';
import { SettingsCard } from '../shared/settings-card';
import { Combobox } from '../ui/combobox';
import { useUserData, useParentInheritance } from '@/context/userData';
import { InheritedBadge } from '../shared/inherited-badge';
import { IconButton } from '../ui/button';
import { MenuTabs } from '../shared/menu-tabs';
import {
  SORT_CRITERIA,
  SORT_CRITERIA_DETAILS,
  SORT_DIRECTIONS,
} from '../../../../core/src/utils/constants';
import {
  DndContext,
  useSensors,
  useSensor,
  PointerSensor,
  TouchSensor,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  arrayMove,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowDownAZ,
  ArrowUpAZ,
  CheckCircle2,
  MinusCircle,
  Globe,
  Film,
  Tv,
  Star,
} from 'lucide-react';
import { cn } from '../ui/core/styling';
import type { UserData } from '@aiostreams/core';

type SortCriteriaItem = {
  key: (typeof SORT_CRITERIA)[number];
  direction: (typeof SORT_DIRECTIONS)[number];
};

type SortKey = keyof NonNullable<UserData['sortCriteria']>;

const SORT_KEY_LABEL: Record<string, string> = {
  global: 'Global',
  movies: 'Movies',
  series: 'Series',
  anime: 'Anime',
  cached: 'Global Cached',
  uncached: 'Global Uncached',
  cachedMovies: 'Movie Cached',
  uncachedMovies: 'Movie Uncached',
  cachedSeries: 'Series Cached',
  uncachedSeries: 'Series Uncached',
  cachedAnime: 'Anime Cached',
  uncachedAnime: 'Anime Uncached',
};

function getSortItems(userData: UserData, key: SortKey): SortCriteriaItem[] {
  return (userData.sortCriteria?.[key] ?? []) as SortCriteriaItem[];
}

interface ResolvedSort {
  primaryKey: SortKey;
  primary: SortCriteriaItem[];
  cachedKey: SortKey | null;
  uncachedKey: SortKey | null;
  cachedItems: SortCriteriaItem[];
  uncachedItems: SortCriteriaItem[];
  splitActive: boolean;
}

function resolveSort(
  userData: UserData,
  type: 'movie' | 'series' | 'anime'
): ResolvedSort {
  const sc = userData.sortCriteria;
  if (!sc) {
    return {
      primaryKey: 'global',
      primary: [],
      cachedKey: null,
      uncachedKey: null,
      cachedItems: [],
      uncachedItems: [],
      splitActive: false,
    };
  }

  let primaryKey: SortKey = 'global';
  let cachedKey: SortKey | null = sc.cached?.length ? 'cached' : null;
  let uncachedKey: SortKey | null = sc.uncached?.length ? 'uncached' : null;

  if (type === 'movie') {
    if (sc.movies?.length) primaryKey = 'movies';
    if (sc.cachedMovies?.length) cachedKey = 'cachedMovies';
    else if (sc.cached?.length) cachedKey = 'cached';
    if (sc.uncachedMovies?.length) uncachedKey = 'uncachedMovies';
    else if (sc.uncached?.length) uncachedKey = 'uncached';
  } else if (type === 'series') {
    if (sc.series?.length) primaryKey = 'series';
    if (sc.cachedSeries?.length) cachedKey = 'cachedSeries';
    else if (sc.cached?.length) cachedKey = 'cached';
    if (sc.uncachedSeries?.length) uncachedKey = 'uncachedSeries';
    else if (sc.uncached?.length) uncachedKey = 'uncached';
  } else {
    if (sc.anime?.length) primaryKey = 'anime';
    if (sc.cachedAnime?.length) cachedKey = 'cachedAnime';
    else if (sc.cached?.length) cachedKey = 'cached';
    if (sc.uncachedAnime?.length) uncachedKey = 'uncachedAnime';
    else if (sc.uncached?.length) uncachedKey = 'uncached';
  }

  const primary = getSortItems(userData, primaryKey);
  const splitActive =
    primary.length > 0 &&
    primary[0].key === 'cached' &&
    cachedKey !== null &&
    uncachedKey !== null;

  const cachedItems = cachedKey ? getSortItems(userData, cachedKey) : [];
  const uncachedItems = uncachedKey ? getSortItems(userData, uncachedKey) : [];

  return {
    primaryKey,
    primary,
    cachedKey,
    uncachedKey,
    cachedItems,
    uncachedItems,
    splitActive,
  };
}

/* -------------------------------------------------------------------------- */
/* SortableItem                                                                */
/* -------------------------------------------------------------------------- */

function SortableItem({
  id,
  name,
  description,
  direction,
  onDirectionChange,
}: {
  id: string;
  name: string;
  description: string;
  direction: (typeof SORT_DIRECTIONS)[number];
  onDirectionChange: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <div className="px-2.5 py-2 bg-[var(--background)] rounded-[--radius-md] border flex gap-3 relative">
        <div
          className="rounded-full w-6 h-auto bg-[--muted] md:bg-[--subtle] md:hover:bg-[--subtle-highlight] cursor-move"
          {...attributes}
          {...listeners}
        />
        <div className="flex-1 flex flex-col justify-center min-w-0">
          <span className="font-mono text-base truncate">{name}</span>
          <span className="text-[--muted] text-sm truncate">{description}</span>
        </div>
        <IconButton
          size="sm"
          rounded
          icon={direction === 'asc' ? <ArrowUpAZ /> : <ArrowDownAZ />}
          intent="primary-subtle"
          onClick={onDirectionChange}
        />
      </div>
    </div>
  );
}

function SortOrderEditor({
  sortKey,
  inheritedFrom,
}: {
  sortKey: SortKey;
  inheritedFrom?: string;
}) {
  const { userData, setUserData } = useUserData();
  const [isDragging, setIsDragging] = useState(false);

  const items = getSortItems(userData, sortKey);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 150, tolerance: 8 },
    })
  );

  useEffect(() => {
    function preventTouchMove(e: TouchEvent) {
      if (isDragging) e.preventDefault();
    }
    if (isDragging) {
      document.body.addEventListener('touchmove', preventTouchMove, {
        passive: false,
      });
    } else {
      document.body.removeEventListener('touchmove', preventTouchMove);
    }
    return () =>
      document.body.removeEventListener('touchmove', preventTouchMove);
  }, [isDragging]);

  function update(newItems: SortCriteriaItem[]) {
    setUserData((prev) => ({
      ...prev,
      sortCriteria: { ...(prev.sortCriteria || {}), [sortKey]: newItems },
    }));
  }

  function handleDragEnd(event: any) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIdx = items.findIndex(
        (i) => `${i.key}-${i.direction}` === active.id
      );
      const newIdx = items.findIndex(
        (i) => `${i.key}-${i.direction}` === over.id
      );
      update(arrayMove(items, oldIdx, newIdx));
    }
    setIsDragging(false);
  }

  return (
    <div className="space-y-2">
      {items.length === 0 && inheritedFrom && (
        <p className="text-xs text-[--muted] italic">
          Empty — using{' '}
          <span className="not-italic text-[--foreground]">
            {inheritedFrom}
          </span>{' '}
          as fallback. Add criteria below to override.
        </p>
      )}
      {items.length === 0 && !inheritedFrom && (
        <p className="text-xs text-[--muted] italic">
          No criteria defined yet.
        </p>
      )}

      <Combobox
        multiple
        value={items.map((i) => i.key)}
        emptyMessage="No sort criteria available"
        onValueChange={(value) => {
          const keys = value as (typeof SORT_CRITERIA)[number][];
          update(
            keys.map(
              (key) =>
                items.find((i) => i.key === key) ?? {
                  key,
                  direction: SORT_CRITERIA_DETAILS[key].defaultDirection,
                }
            )
          );
        }}
        options={SORT_CRITERIA.map((c) => ({
          label: SORT_CRITERIA_DETAILS[c].name,
          textValue: SORT_CRITERIA_DETAILS[c].name,
          value: c,
        }))}
      />

      {items.length > 0 && (
        <DndContext
          modifiers={[restrictToVerticalAxis]}
          onDragEnd={handleDragEnd}
          onDragStart={() => setIsDragging(true)}
          sensors={sensors}
        >
          <SortableContext
            items={items.map((i) => `${i.key}-${i.direction}`)}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-2">
              {items.map((item) => (
                <SortableItem
                  key={`${item.key}-${item.direction}`}
                  id={`${item.key}-${item.direction}`}
                  name={SORT_CRITERIA_DETAILS[item.key].name}
                  description={
                    item.direction === 'asc'
                      ? `${SORT_CRITERIA_DETAILS[item.key].description}, ${SORT_CRITERIA_DETAILS[item.key].ascendingDescription}`
                      : `${SORT_CRITERIA_DETAILS[item.key].description}, ${SORT_CRITERIA_DETAILS[item.key].descendingDescription}`
                  }
                  direction={item.direction}
                  onDirectionChange={() => {
                    const dir =
                      item.direction === 'asc'
                        ? ('desc' as const)
                        : ('asc' as const);
                    update(
                      items.map((i) =>
                        i.key === item.key ? { ...i, direction: dir } : i
                      )
                    );
                  }}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}

/** Chips showing the first few criteria names. */
function CriteriaTags({ items }: { items: SortCriteriaItem[] }) {
  if (items.length === 0) return null;
  const shown = items.slice(0, 3);
  return (
    <span className="flex flex-wrap items-center gap-1">
      {shown.map((c) => (
        <span
          key={c.key}
          className="text-xs px-1.5 py-0.5 rounded bg-[--subtle] text-[--muted] border border-[--border]"
        >
          {SORT_CRITERIA_DETAILS[c.key].name}
        </span>
      ))}
      {items.length > 3 && (
        <span className="text-xs text-[--muted]">+{items.length - 3}</span>
      )}
    </span>
  );
}

/** Visually distinct pill for which sort-order definition is supplying the criteria. */
function SourcePill({ sortKey }: { sortKey: SortKey }) {
  // Global-level keys → violet; type-specific → blue
  const isGlobal =
    sortKey === 'global' || sortKey === 'cached' || sortKey === 'uncached';
  return (
    <span
      className={cn(
        'text-xs px-1.5 py-0.5 rounded border font-medium shrink-0',
        isGlobal
          ? 'bg-violet-500/10 text-violet-400 border-violet-500/20'
          : 'bg-blue-500/10 text-blue-400 border-blue-500/20'
      )}
    >
      {SORT_KEY_LABEL[sortKey]}
    </span>
  );
}

function SortPreviewCard() {
  const { userData } = useUserData();

  const rows = [
    {
      type: 'movie' as const,
      label: 'Movies',
      icon: <Film className="w-3.5 h-3.5" />,
    },
    {
      type: 'series' as const,
      label: 'Series',
      icon: <Tv className="w-3.5 h-3.5" />,
    },
    {
      type: 'anime' as const,
      label: 'Anime',
      icon: <Star className="w-3.5 h-3.5" />,
    },
  ];

  return (
    <SettingsCard
      title="Active Sort Configuration"
      description="The sort orders that will actually be applied for each content type."
    >
      <div className="divide-y divide-[--border]">
        {rows.map(({ type, label, icon }) => {
          const info = resolveSort(userData, type);

          return (
            <div key={type} className="py-3 first:pt-0 last:pb-0 space-y-2">
              {/* Header */}
              <div className="flex items-center gap-2 text-sm font-medium">
                <span className="text-[--muted]">{icon}</span>
                {label}
                {info.splitActive && (
                  <span className="flex items-center gap-0.5 text-xs font-normal text-green-400">
                    <CheckCircle2 className="w-3 h-3" />
                    split
                  </span>
                )}
              </div>

              {/* Sort rows */}
              {!info.splitActive ? (
                /* Non-split: single line — source pill → criteria */
                <div className="ml-5 flex items-center gap-1.5 flex-wrap">
                  <SourcePill sortKey={info.primaryKey} />
                  {info.primary.length > 0 && (
                    <span className="text-[--muted] text-xs shrink-0">→</span>
                  )}
                  <CriteriaTags items={info.primary} />
                  {info.primary.length === 0 && (
                    <span className="text-xs text-[--muted] italic">
                      no criteria defined
                    </span>
                  )}
                </div>
              ) : (
                /* Split mode: two sub-rows, one per cache state */
                <div className="ml-5 space-y-1.5">
                  {(
                    [
                      {
                        dot: 'bg-green-400',
                        label: 'Cached',
                        key: info.cachedKey!,
                        items: info.cachedItems,
                      },
                      {
                        dot: 'bg-yellow-400',
                        label: 'Uncached',
                        key: info.uncachedKey!,
                        items: info.uncachedItems,
                      },
                    ] as const
                  ).map(({ dot, label: subLabel, key, items }) => (
                    <div
                      key={subLabel}
                      className="flex items-center gap-1.5 flex-wrap"
                    >
                      <span
                        className={cn('w-1.5 h-1.5 rounded-full shrink-0', dot)}
                      />
                      <SourcePill sortKey={key} />
                      {items.length > 0 && (
                        <span className="text-[--muted] text-xs shrink-0">
                          →
                        </span>
                      )}
                      <CriteriaTags items={items} />
                      {items.length === 0 && (
                        <span className="text-xs text-[--muted] italic">
                          no criteria defined
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Warning: cached/uncached sorts are defined but split mode isn't active */}
              {!info.splitActive && (info.cachedKey || info.uncachedKey) && (
                <div className="ml-5 flex items-start gap-1.5 text-xs text-yellow-500/80">
                  <MinusCircle className="w-3.5 h-3.5 shrink-0 mt-px" />
                  <span>
                    Cached sorts are defined but inactive — make{' '}
                    <span className="text-yellow-400">Cached</span> the first
                    primary criterion to enable split mode
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </SettingsCard>
  );
}

interface TabConfig {
  primaryKey: SortKey;
  cachedKey: SortKey;
  uncachedKey: SortKey;
  primaryLabel: string;
  primaryDescription: string;
  primaryInherit?: string;
  cachedInherit?: string;
  uncachedInherit?: string;
}

const TAB_CONFIGS: Record<string, TabConfig> = {
  global: {
    primaryKey: 'global',
    cachedKey: 'cached',
    uncachedKey: 'uncached',
    primaryLabel: 'Primary Sort Order',
    primaryDescription:
      'The default sort applied to all content. Movie, Series, and Anime tabs can each define their own override.',
  },
  movies: {
    primaryKey: 'movies',
    cachedKey: 'cachedMovies',
    uncachedKey: 'uncachedMovies',
    primaryLabel: 'Movie Primary Sort',
    primaryDescription:
      'Overrides the Global primary sort for movies. Leave empty to fall back to Global.',
    primaryInherit: 'Global',
    cachedInherit: 'Global Cached',
    uncachedInherit: 'Global Uncached',
  },
  series: {
    primaryKey: 'series',
    cachedKey: 'cachedSeries',
    uncachedKey: 'uncachedSeries',
    primaryLabel: 'Series Primary Sort',
    primaryDescription:
      'Overrides the Global primary sort for series. Leave empty to fall back to Global.',
    primaryInherit: 'Global',
    cachedInherit: 'Global Cached',
    uncachedInherit: 'Global Uncached',
  },
  anime: {
    primaryKey: 'anime',
    cachedKey: 'cachedAnime',
    uncachedKey: 'uncachedAnime',
    primaryLabel: 'Anime Primary Sort',
    primaryDescription:
      'Overrides the Global primary sort for anime. Leave empty to fall back to Global.',
    primaryInherit: 'Global',
    cachedInherit: 'Global Cached',
    uncachedInherit: 'Global Uncached',
  },
};

function SortTabContent({
  type,
}: {
  type: 'global' | 'movies' | 'series' | 'anime';
}) {
  const { userData } = useUserData();
  const cfg = TAB_CONFIGS[type];
  const sc = userData.sortCriteria;

  // Compute inherited-from labels for the cached/uncached sub-sorts
  function cachedInherit(): string | undefined {
    if (type === 'global') return undefined; // global cached has no parent
    const globalCachedDefined = (sc?.cached?.length ?? 0) > 0;
    return globalCachedDefined ? 'Global Cached' : undefined;
  }

  function uncachedInherit(): string | undefined {
    if (type === 'global') return undefined;
    const globalUncachedDefined = (sc?.uncached?.length ?? 0) > 0;
    return globalUncachedDefined ? 'Global Uncached' : undefined;
  }

  return (
    <div className="space-y-4">
      <SettingsCard
        title={cfg.primaryLabel}
        description={cfg.primaryDescription}
      >
        <SortOrderEditor
          sortKey={cfg.primaryKey}
          inheritedFrom={cfg.primaryInherit}
        />
      </SettingsCard>

      <SettingsCard
        title="Split by Cache"
        description={
          <>
            When <strong>"Cached"</strong> is the{' '}
            <strong>first criterion</strong> above and both sorts below are
            defined, cached and uncached streams are sorted independently then
            merged.
          </>
        }
      >
        <div className="space-y-6">
          {/* Cached */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
              <span className="text-sm font-medium">Cached Streams</span>
              {getSortItems(userData, cfg.cachedKey).length === 0 && (
                <span className="text-xs text-[--muted]">
                  {cachedInherit()
                    ? `— using ${cachedInherit()} as fallback`
                    : '— undefined, split requires this'}
                </span>
              )}
            </div>
            <SortOrderEditor
              sortKey={cfg.cachedKey}
              inheritedFrom={cachedInherit()}
            />
          </div>

          <div className="border-t border-[--border]" />

          {/* Uncached */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-yellow-400 shrink-0" />
              <span className="text-sm font-medium">Uncached Streams</span>
              {getSortItems(userData, cfg.uncachedKey).length === 0 && (
                <span className="text-xs text-[--muted]">
                  {uncachedInherit()
                    ? `— using ${uncachedInherit()} as fallback`
                    : '— undefined, split requires this'}
                </span>
              )}
            </div>
            <SortOrderEditor
              sortKey={cfg.uncachedKey}
              inheritedFrom={uncachedInherit()}
            />
          </div>
        </div>
      </SettingsCard>
    </div>
  );
}

export function SortingMenu() {
  return (
    <PageWrapper className="space-y-4 p-4 sm:p-8">
      <Content />
    </PageWrapper>
  );
}

function Content() {
  const { userData, setUserData } = useUserData();
  const { isInherited, hasParent } = useParentInheritance();
  const [activeTab, setActiveTab] = useState('global');

  useEffect(() => {
    if (!userData.sortCriteria) {
      setUserData((prev) => ({
        ...prev,
        sortCriteria: {
          global: [],
          movies: [],
          series: [],
          anime: [],
          cached: [],
          uncached: [],
          cachedMovies: [],
          uncachedMovies: [],
          cachedSeries: [],
          uncachedSeries: [],
          cachedAnime: [],
          uncachedAnime: [],
        },
      }));
    }
  }, []);

  const sc = userData.sortCriteria;

  // Whether a non-global tab has any custom criteria
  const hasMovies =
    (sc?.movies?.length ?? 0) > 0 ||
    (sc?.cachedMovies?.length ?? 0) > 0 ||
    (sc?.uncachedMovies?.length ?? 0) > 0;
  const hasSeries =
    (sc?.series?.length ?? 0) > 0 ||
    (sc?.cachedSeries?.length ?? 0) > 0 ||
    (sc?.uncachedSeries?.length ?? 0) > 0;
  const hasAnime =
    (sc?.anime?.length ?? 0) > 0 ||
    (sc?.cachedAnime?.length ?? 0) > 0 ||
    (sc?.uncachedAnime?.length ?? 0) > 0;

  function tabLabel(name: string, active: boolean) {
    return (
      <span className="flex items-center gap-1.5">
        {name}
        {active && (
          <span className="w-1.5 h-1.5 rounded-full bg-blue-400 inline-block" />
        )}
      </span>
    );
  }

  return (
    <>
      <div className="flex items-center w-full">
        <div>
          <div className="flex items-center gap-2">
            <h2>Sorting</h2>
            {hasParent && isInherited('sorting') && <InheritedBadge section="sorting" />}
          </div>
          <p className="text-[--muted]">
            Configure how your streams are sorted and organised.
          </p>
        </div>
        <div className="hidden lg:block lg:ml-auto">
          <PageControls />
        </div>
      </div>

      <SortPreviewCard />

      <MenuTabs
        tabs={[
          {
            value: 'global',
            label: 'Global',
            icon: <Globe className="w-4 h-4" />,
            content: <SortTabContent type="global" />,
          },
          {
            value: 'movies',
            label: tabLabel('Movies', hasMovies),
            icon: <Film className="w-4 h-4" />,
            content: <SortTabContent type="movies" />,
          },
          {
            value: 'series',
            label: tabLabel('Series', hasSeries),
            icon: <Tv className="w-4 h-4" />,
            content: <SortTabContent type="series" />,
          },
          {
            value: 'anime',
            label: tabLabel('Anime', hasAnime),
            icon: <Star className="w-4 h-4" />,
            content: <SortTabContent type="anime" />,
          },
        ]}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />
    </>
  );
}
