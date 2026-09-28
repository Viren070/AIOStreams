import React, {
  useState,
  useMemo,
  useEffect,
  useRef,
  useCallback,
  useDeferredValue,
  startTransition,
} from 'react';
import { CatalogModification, UserData } from '@aiostreams/core';
import { useUserData } from '@/context/userData';
import { SettingsCard } from '../../../shared/settings-card';
import { Button, IconButton } from '@aiostreams/ui/button';
import { Checkbox } from '@aiostreams/ui/checkbox';
import { Combobox } from '@aiostreams/ui/combobox';
import { Select } from '@aiostreams/ui/select';
import { TextInput } from '@aiostreams/ui/text-input';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@aiostreams/ui/dropdown-menu';
import { Modal } from '@aiostreams/ui/modal';
import { Switch } from '@aiostreams/ui/switch';
import {
  DndContext,
  useSensor,
  useSensors,
  PointerSensor,
  TouchSensor,
} from '@dnd-kit/core';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import {
  arrayMove,
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { MdRefresh } from 'react-icons/md';
import { SearchIcon } from 'lucide-react';
import { LuChevronDown } from 'react-icons/lu';
import {
  SortableCatalogItem,
  hideFromHome,
  isMerged,
  onHome,
  showOnHome,
  type CatalogUpdate,
} from './sortable-catalog-item';
import {
  addonOf,
  catalogKey,
  disabledPresets,
  presetOf,
  withUpstreamOrder,
} from './catalog-order';
import type { MergeRequest } from './merged-catalogs';
import { useStatus } from '@/context/status';

const MODIFIERS = [restrictToVerticalAxis];
const FIRST_ROWS = 30;
/** Catalog types are free text, and some addons use `all`. */
const ANY_TYPE = '\u0000any';

type Status = 'all' | 'on' | 'off' | 'home' | 'discover' | 'new';

const STATUS_OPTIONS: { value: Status; label: string }[] = [
  { value: 'all', label: 'Any status' },
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' },
  { value: 'home', label: 'On home' },
  { value: 'discover', label: 'Not on home' },
  { value: 'new', label: 'New' },
];

type AddonList = 'newCatalogsDisabled' | 'upstreamCatalogOrder';

function sourceKey(encoded: string): string {
  const params = new URLSearchParams(encoded);
  return catalogKey({
    id: params.get('id') ?? '',
    type: params.get('type') ?? '',
  });
}

export function CatalogSettingsCard({
  loading,
  fetchCatalogsData,
  newCatalogs,
  upstreamKeys,
  onMerge,
}: {
  onMerge: (request: MergeRequest) => void;
  loading: boolean;
  fetchCatalogsData: (hideToast?: boolean) => void | Promise<void>;
  /** Catalogs the last refresh found that the saved list lacked. */
  newCatalogs: ReadonlySet<string>;
  /** Every catalog in the order the addons list them. */
  upstreamKeys: string[];
}) {
  const { userData, setUserData } = useUserData();

  const mergedCatalogsCountRef = useRef(userData.mergedCatalogs?.length ?? 0);
  useEffect(() => {
    const currentCount = userData.mergedCatalogs?.length ?? 0;
    if (currentCount !== mergedCatalogsCountRef.current) {
      mergedCatalogsCountRef.current = currentCount;
      fetchCatalogsData(true);
    }
  }, [userData.mergedCatalogs?.length, fetchCatalogsData]);

  const sourceCatalogsInMergedCatalogs = useMemo(
    () =>
      new Set(
        (userData.mergedCatalogs || [])
          .filter((mc) => mc.enabled !== false)
          .flatMap((mc) => mc.catalogIds.map(sourceKey))
      ),
    [userData.mergedCatalogs]
  );

  const offPresets = useMemo(
    () => disabledPresets(userData.presets),
    [userData.presets]
  );
  const catalogs = useMemo(
    () =>
      (userData.catalogModifications ?? []).filter(
        (catalog) =>
          !sourceCatalogsInMergedCatalogs.has(catalogKey(catalog)) &&
          !offPresets.has(presetOf(catalog.id))
      ),
    [userData.catalogModifications, sourceCatalogsInMergedCatalogs, offPresets]
  );

  const [search, setSearch] = useState('');
  const [addons, setAddons] = useState<string[]>([]);
  const [type, setType] = useState(ANY_TYPE);
  const [status, setStatus] = useState<Status>('all');

  const addonOptions = useMemo(() => {
    const names = new Map<string, string>();
    for (const c of catalogs) {
      const addon = addonOf(c.id);
      if (!names.has(addon))
        names.set(
          addon,
          isMerged(c) ? 'Merged catalogs' : (c.addonName ?? addon)
        );
    }
    const seen = new Map<string, number>();
    return [...names].map(([value, name]) => {
      const n = (seen.get(name) ?? 0) + 1;
      seen.set(name, n);
      const label = n > 1 ? `${name} (${n})` : name;
      return { value, label, textValue: label };
    });
  }, [catalogs]);

  const typeOptions = useMemo(
    () => [
      { value: ANY_TYPE, label: 'Any type' },
      ...[...new Set(catalogs.map((c) => c.overrideType ?? c.type))].map(
        (t) => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1) })
      ),
    ],
    [catalogs]
  );

  const deferredSearch = useDeferredValue(search);
  const visible = useMemo(() => {
    const query = deferredSearch.trim().toLowerCase();
    const matchesStatus = (c: CatalogModification) => {
      const enabled = c.enabled !== false;
      switch (status) {
        case 'on':
          return enabled;
        case 'off':
          return !enabled;
        case 'home':
          return enabled && onHome(c);
        case 'discover':
          return enabled && !onHome(c);
        case 'new':
          return newCatalogs.has(catalogKey(c));
        default:
          return true;
      }
    };
    return catalogs.filter(
      (c) =>
        (!addons.length || addons.includes(addonOf(c.id))) &&
        (type === ANY_TYPE || (c.overrideType ?? c.type) === type) &&
        matchesStatus(c) &&
        (!query ||
          [c.name, c.id, c.addonName].some((v) =>
            v?.toLowerCase().includes(query)
          ))
    );
  }, [catalogs, deferredSearch, addons, type, status, newCatalogs]);
  const visibleKeys = useMemo(() => visible.map(catalogKey), [visible]);

  // The first screenful mounts at once; the rest follows without blocking.
  const [rowLimit, setRowLimit] = useState(FIRST_ROWS);
  useEffect(() => {
    if (rowLimit < visible.length)
      startTransition(() => setRowLimit(Number.POSITIVE_INFINITY));
  }, [rowLimit, visible.length]);
  const rendered = useMemo(
    () => (rowLimit < visible.length ? visible.slice(0, rowLimit) : visible),
    [visible, rowLimit]
  );
  const renderedKeys = useMemo(() => rendered.map(catalogKey), [rendered]);

  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const anchor = useRef<string | null>(null);
  const shownKeys = useRef(visibleKeys);
  shownKeys.current = visibleKeys;
  // Actions only ever reach catalogs that are on screen.
  useEffect(() => {
    setSelected(new Set());
    anchor.current = null;
  }, [deferredSearch, addons, type, status]);
  // An action can move a catalog out of the filter.
  useEffect(() => {
    const shown = new Set(visibleKeys);
    setSelected((prev) =>
      [...prev].every((k) => shown.has(k))
        ? prev
        : new Set([...prev].filter((k) => shown.has(k)))
    );
  }, [visibleKeys]);

  const selectCatalog = useCallback((key: string, range: boolean) => {
    const from = anchor.current;
    anchor.current = key;
    setSelected((prev) => {
      const next = new Set(prev);
      const keys = shownKeys.current;
      const start = from ? keys.indexOf(from) : -1;
      const end = keys.indexOf(key);
      if (range && start !== -1 && end !== -1) {
        const select = !prev.has(key);
        for (const k of keys.slice(
          Math.min(start, end),
          Math.max(start, end) + 1
        ))
          if (select) next.add(k);
          else next.delete(k);
      } else if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const selectedCount = visibleKeys.filter((k) => selected.has(k)).length;
  const allSelected = visible.length > 0 && selectedCount === visible.length;
  const enabledCount = catalogs.filter((c) => c.enabled !== false).length;

  const reorder = useCallback(
    (prev: UserData, mods: CatalogModification[]): UserData => ({
      ...prev,
      catalogModifications: withUpstreamOrder(
        mods,
        new Set(prev.upstreamCatalogOrder),
        upstreamKeys
      ),
    }),
    [upstreamKeys]
  );

  const updateCatalog = useCallback(
    (id: string, type: string, update: CatalogUpdate) => {
      setUserData((prev) => ({
        ...prev,
        catalogModifications: prev.catalogModifications?.map((c) =>
          c.id === id && c.type === type ? update(c) : c
        ),
      }));
    },
    [setUserData]
  );

  const moveCatalog = useCallback(
    (id: string, type: string, to: 'top' | 'bottom') => {
      setUserData((prev) => {
        if (!prev.catalogModifications) return prev;
        const index = prev.catalogModifications.findIndex(
          (c) => c.id === id && c.type === type
        );
        const last = prev.catalogModifications.length - 1;
        if (index < 0 || index === (to === 'top' ? 0 : last)) return prev;
        const newMods = [...prev.catalogModifications];
        const [item] = newMods.splice(index, 1);
        if (to === 'top') newMods.unshift(item);
        else newMods.push(item);
        return reorder(prev, newMods);
      });
    },
    [setUserData, reorder]
  );

  const toggleCatalog = useCallback(
    (id: string, type: string, enabled: boolean) => {
      setUserData((prev) => ({
        ...prev,
        catalogModifications: prev.catalogModifications?.map((c) =>
          c.id === id && c.type === type ? { ...c, enabled } : c
        ),
        ...(id.startsWith('aiostreams.merged.') && {
          mergedCatalogs: prev.mergedCatalogs?.map((mc) =>
            mc.id === id ? { ...mc, enabled } : mc
          ),
        }),
      }));
    },
    [setUserData]
  );

  const updateSelected = (update: CatalogUpdate) =>
    setUserData((prev) => ({
      ...prev,
      catalogModifications: prev.catalogModifications?.map((c) =>
        selected.has(catalogKey(c)) ? update(c) : c
      ),
    }));

  const enableSelected = (enabled: boolean) =>
    setUserData((prev) => ({
      ...prev,
      catalogModifications: prev.catalogModifications?.map((c) =>
        selected.has(catalogKey(c)) ? { ...c, enabled } : c
      ),
      mergedCatalogs: prev.mergedCatalogs?.map((mc) =>
        selected.has(catalogKey(mc)) ? { ...mc, enabled } : mc
      ),
    }));

  const moveSelected = (to: 'top' | 'bottom') =>
    setUserData((prev) => {
      const mods = prev.catalogModifications ?? [];
      const picked = mods.filter((c) => selected.has(catalogKey(c)));
      const rest = mods.filter((c) => !selected.has(catalogKey(c)));
      return reorder(
        prev,
        to === 'top' ? [...picked, ...rest] : [...rest, ...picked]
      );
    });

  const toggleAddon = (list: AddonList, addon: string) =>
    setUserData((prev) => {
      const next = new Set(prev[list]);
      if (next.has(addon)) next.delete(addon);
      else next.add(addon);
      const updated = { ...prev, [list]: next.size ? [...next] : undefined };
      return list === 'upstreamCatalogOrder'
        ? reorder(updated, prev.catalogModifications ?? [])
        : updated;
    });

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 150,
        tolerance: 8,
      },
    })
  );

  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    function preventTouchMove(e: TouchEvent) {
      if (isDragging) {
        e.preventDefault();
      }
    }

    function handleDragEnd() {
      setIsDragging(false);
    }

    if (isDragging) {
      document.body.addEventListener('touchmove', preventTouchMove, {
        passive: false,
      });
      document.addEventListener('pointerup', handleDragEnd);
      document.addEventListener('touchend', handleDragEnd);
    } else {
      document.body.removeEventListener('touchmove', preventTouchMove);
    }
    return () => {
      document.body.removeEventListener('touchmove', preventTouchMove);
      document.removeEventListener('pointerup', handleDragEnd);
      document.removeEventListener('touchend', handleDragEnd);
    };
  }, [isDragging]);

  const handleDragEnd = (event: any) => {
    const { active, over } = event;
    if (!over) return;
    if (active.id !== over.id) {
      setUserData((prev) => {
        const oldIndex = prev.catalogModifications?.findIndex(
          (c) => catalogKey(c) === active.id
        );
        const newIndex = prev.catalogModifications?.findIndex(
          (c) => catalogKey(c) === over.id
        );
        if (
          oldIndex === undefined ||
          newIndex === undefined ||
          !prev.catalogModifications
        )
          return prev;
        return reorder(
          prev,
          arrayMove(prev.catalogModifications, oldIndex, newIndex)
        );
      });
    }
    setIsDragging(false);
  };

  const { status: instanceStatus } = useStatus();
  const maxMergeSources =
    instanceStatus?.settings?.limits?.maxMergedCatalogSources ?? 10;
  const mergeable = visible.filter(
    (c) => !isMerged(c) && selected.has(catalogKey(c))
  );
  const editMerged = useCallback(
    (id: string) => onMerge({ kind: 'edit', id }),
    [onMerge]
  );

  const addonChoices = addonOptions.filter((o) => o.value !== 'aiostreams');
  const [addonOptionsOpen, setAddonOptionsOpen] = useState(false);

  const none = selectedCount === 0;

  return (
    <SettingsCard
      title="Catalogs"
      id="catalogs"
      description="Rename, reorder, and toggle your catalogs, and apply modifications like RPDB posters and shuffling. Adjusting catalogs may require a reinstall - if it does, a pop-up will tell you."
      action={
        <IconButton
          size="sm"
          intent="warning-subtle"
          icon={<MdRefresh />}
          rounded
          onClick={() => {
            fetchCatalogsData();
          }}
          loading={loading}
        />
      }
    >
      {!userData.catalogModifications?.length ? (
        <p className="text-[--muted] text-base text-center my-8">
          Your addons don't have any catalogs... or you haven't fetched them yet
          :/
        </p>
      ) : (
        <>
          <div
            data-ui="catalog-toolbar"
            className="sticky top-0 z-10 -mx-4 space-y-2 border-b bg-[--background] px-4 pb-3 pt-2 lg:bg-gray-950"
          >
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-[minmax(0,1fr),13rem,9rem,10rem]">
              <div className="col-span-2 lg:col-span-1">
                <TextInput
                  leftIcon={<SearchIcon className="h-4 w-4" />}
                  placeholder="Search catalogs"
                  value={search}
                  onValueChange={setSearch}
                />
              </div>
              <div className="col-span-2 lg:col-span-1">
                <Combobox
                  multiple
                  options={addonOptions}
                  value={addons}
                  onValueChange={setAddons}
                  placeholder="Any addon"
                  emptyMessage="No addons match."
                />
              </div>
              <Select
                options={typeOptions}
                value={type}
                onValueChange={setType}
              />
              <Select
                options={STATUS_OPTIONS}
                value={status}
                onValueChange={(v) => setStatus(v as Status)}
              />
            </div>
            <div className="flex items-center gap-3">
              <Checkbox
                fieldClass="flex w-auto flex-none"
                aria-label="Select every catalog shown"
                value={allSelected ? true : none ? false : 'indeterminate'}
                onClick={(e) => {
                  e.preventDefault();
                  setSelected(allSelected ? new Set() : new Set(visibleKeys));
                }}
              />
              <p className="min-w-0 flex-1 truncate text-sm text-[--muted]">
                {none ? `${visible.length} shown` : `${selectedCount} selected`}{' '}
                · {enabledCount}/{catalogs.length} on
              </p>
              <DropdownMenu
                align="end"
                trigger={
                  <Button
                    size="sm"
                    intent="gray-outline"
                    rounded
                    rightIcon={<LuChevronDown />}
                  >
                    Actions
                  </Button>
                }
              >
                <DropdownMenuLabel>
                  {none
                    ? 'Select catalogs to change them'
                    : `${selectedCount} selected`}
                </DropdownMenuLabel>
                <DropdownMenuItem
                  disabled={none}
                  onSelect={() => enableSelected(true)}
                >
                  Turn on
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={none}
                  onSelect={() => enableSelected(false)}
                >
                  Turn off
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={none}
                  onSelect={() => updateSelected(showOnHome)}
                >
                  Show on home
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={none}
                  onSelect={() => updateSelected(hideFromHome)}
                >
                  Discover only
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={none}
                  onSelect={() =>
                    updateSelected((c) => ({ ...c, usePosterService: true }))
                  }
                >
                  Use poster services
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={none}
                  onSelect={() =>
                    updateSelected((c) => ({ ...c, usePosterService: false }))
                  }
                >
                  Stop using poster services
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={none}
                  onSelect={() => moveSelected('top')}
                >
                  Move to top
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={none}
                  onSelect={() => moveSelected('bottom')}
                >
                  Move to bottom
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={
                    mergeable.length < 2 || mergeable.length > maxMergeSources
                  }
                  onSelect={() =>
                    onMerge({
                      kind: 'new',
                      catalogs: mergeable.map(({ id, type }) => ({ id, type })),
                    })
                  }
                >
                  <span className="flex flex-col">
                    <span>Merge into one catalog…</span>
                    {(mergeable.length < 2 ||
                      mergeable.length > maxMergeSources) && (
                      <span className="text-xs text-[--muted]">
                        Select 2 to {maxMergeSources} catalogs
                      </span>
                    )}
                  </span>
                </DropdownMenuItem>
                {addonChoices.length > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onSelect={() => setAddonOptionsOpen(true)}
                    >
                      Addon options…
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenu>
              <Modal
                open={addonOptionsOpen}
                onOpenChange={setAddonOptionsOpen}
                title="Addon options"
                description="How catalogs an addon adds or reorders later are handled."
              >
                <div className="space-y-6">
                  {addonChoices.map((o) => (
                    <div key={o.value} className="space-y-3">
                      <p className="text-sm font-semibold">{o.label}</p>
                      <Switch
                        side="right"
                        label="Turn new catalogs on"
                        help="Catalogs the addon adds later start turned on. Turn this off to review them first."
                        value={!userData.newCatalogsDisabled?.includes(o.value)}
                        onValueChange={() =>
                          toggleAddon('newCatalogsDisabled', o.value)
                        }
                      />
                      <Switch
                        side="right"
                        label="Keep the addon's order"
                        help="Its catalogs stay in the positions you give them, but in the order the addon lists them, and new ones appear next to the others."
                        value={
                          userData.upstreamCatalogOrder?.includes(o.value) ??
                          false
                        }
                        onValueChange={() =>
                          toggleAddon('upstreamCatalogOrder', o.value)
                        }
                      />
                    </div>
                  ))}
                </div>
              </Modal>
            </div>
          </div>
          {visible.length === 0 ? (
            <p className="my-8 text-center text-sm text-[--muted]">
              No catalogs match.
            </p>
          ) : (
            <DndContext
              modifiers={MODIFIERS}
              onDragEnd={handleDragEnd}
              onDragStart={() => setIsDragging(true)}
              sensors={sensors}
            >
              <SortableContext
                items={renderedKeys}
                strategy={verticalListSortingStrategy}
              >
                <ul className="space-y-1.5">
                  {rendered.map((catalog) => {
                    const key = catalogKey(catalog);
                    return (
                      <SortableCatalogItem
                        key={key}
                        catalog={catalog}
                        isNew={newCatalogs.has(key)}
                        selected={selected.has(key)}
                        onSelect={selectCatalog}
                        onUpdate={updateCatalog}
                        onMove={moveCatalog}
                        onToggleEnabled={toggleCatalog}
                        onEditMerged={editMerged}
                      />
                    );
                  })}
                </ul>
              </SortableContext>
            </DndContext>
          )}
        </>
      )}
    </SettingsCard>
  );
}
