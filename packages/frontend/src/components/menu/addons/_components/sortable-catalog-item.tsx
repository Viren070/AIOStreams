import React, { memo, useState } from 'react';
import { CatalogModification } from '@aiostreams/core';
import type {
  DraggableAttributes,
  DraggableSyntheticListeners,
} from '@dnd-kit/core';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { IconButton, Button } from '@aiostreams/ui/button';
import { Switch } from '@aiostreams/ui/switch';
import { Checkbox } from '@aiostreams/ui/checkbox';
import { Badge } from '@aiostreams/ui/badge';
import { Modal } from '@aiostreams/ui/modal';
import { TextInput } from '@aiostreams/ui/text-input';
import { NumberInput } from '@aiostreams/ui/number-input';
import {
  LuChevronsUp,
  LuChevronsDown,
  LuMerge,
  LuSettings2,
} from 'react-icons/lu';
import {
  TbSearch,
  TbSearchOff,
  TbSmartHome,
  TbSmartHomeOff,
} from 'react-icons/tb';
import { MdSavedSearch } from 'react-icons/md';
import { FaArrowLeftLong, FaArrowRightLong, FaShuffle } from 'react-icons/fa6';
import { PiStarFill, PiStarBold } from 'react-icons/pi';
import { toast } from 'sonner';
import { catalogKey } from './catalog-order';

export type CatalogUpdate = (
  catalog: CatalogModification
) => CatalogModification;

const capitalise = (str: string | undefined) =>
  str ? str.charAt(0).toUpperCase() + str.slice(1) : '';

const catalogOrderStates = ['default', 'shuffle', 'reverse'] as const;
const orderState = (c: CatalogModification) =>
  c.shuffle ? 'shuffle' : c.reverse ? 'reverse' : 'default';

export const isMerged = (c: CatalogModification) =>
  c.id.startsWith('aiostreams.merged.');

export function onHome(c: CatalogModification): boolean {
  if (c.genreRequired) return !!c.showOnHome;
  return c.hideable !== false && !c.onlyOnDiscover && !c.onlyOnSearch;
}

export const showOnHome: CatalogUpdate = (c) =>
  c.genreRequired
    ? { ...c, showOnHome: true, onlyOnSearch: false }
    : c.hideable !== false
      ? { ...c, onlyOnDiscover: false, onlyOnSearch: false }
      : c;

export const hideFromHome: CatalogUpdate = (c) =>
  c.genreRequired
    ? { ...c, showOnHome: false }
    : c.hideable !== false
      ? { ...c, onlyOnDiscover: true, onlyOnSearch: false }
      : c;

// Keyed by id and type so the parent can pass the same callbacks to every row.
interface CatalogItemProps {
  catalog: CatalogModification;
  isNew: boolean;
  selected: boolean;
  onSelect: (key: string, range: boolean) => void;
  onUpdate: (id: string, type: string, update: CatalogUpdate) => void;
  onMove: (id: string, type: string, to: 'top' | 'bottom') => void;
  onToggleEnabled: (id: string, type: string, enabled: boolean) => void;
  onEditMerged: (id: string) => void;
}

// useSortable re-renders all rows on each drag change; the body stays memoised
export const SortableCatalogItem = memo(function SortableCatalogItem(
  props: CatalogItemProps
) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: catalogKey(props.catalog) });

  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
    >
      <CatalogRow {...props} attributes={attributes} listeners={listeners} />
    </li>
  );
});

const CatalogRow = memo(function CatalogRow({
  catalog,
  isNew,
  selected,
  onSelect,
  onUpdate,
  onMove,
  onToggleEnabled,
  onEditMerged,
  attributes,
  listeners,
}: CatalogItemProps & {
  attributes: DraggableAttributes;
  listeners: DraggableSyntheticListeners;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const update = (fn: CatalogUpdate) => onUpdate(catalog.id, catalog.type, fn);
  const enabled = catalog.enabled ?? true;
  const merged = isMerged(catalog);
  const iconClass = 'h-8 w-8 text-lg';

  return (
    <>
      <div
        data-selected={selected || undefined}
        className="flex items-center gap-2 rounded-[--radius-md] border bg-[var(--background)] px-2 py-1.5 transition-colors data-[selected]:border-[--brand] md:gap-3"
      >
        <div
          className="h-9 w-2.5 flex-shrink-0 cursor-move rounded-full bg-[var(--subtle)] hover:bg-[var(--subtle-highlight)] md:w-3"
          {...attributes}
          {...listeners}
        />
        <Checkbox
          value={selected}
          fieldClass="flex w-auto flex-none"
          aria-label="Select catalog"
          onClick={(e) => {
            e.preventDefault();
            onSelect(catalogKey(catalog), e.shiftKey);
          }}
        />
        <div
          className={`min-w-0 flex-1 ${enabled ? '' : 'opacity-50'}`}
          title={catalog.id}
        >
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium">
              {catalog.name ?? catalog.id}
            </p>
            {isNew && (
              <Badge intent="primary" size="sm" className="flex-shrink-0">
                New
              </Badge>
            )}
          </div>
          <p className="truncate text-xs text-[--muted]">
            {capitalise(catalog.overrideType ?? catalog.type)} ·{' '}
            {merged ? 'Merged catalog' : catalog.addonName}
          </p>
        </div>
        <div className="hidden flex-shrink-0 items-center gap-1 md:flex">
          {merged && (
            <div
              title="Merged Catalog"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--brand-subtle)]"
            >
              <LuMerge className="text-lg text-[var(--brand)]" />
            </div>
          )}
          <IconButton
            className={iconClass}
            icon={<LuChevronsUp />}
            intent="primary-subtle"
            rounded
            title="Move to top"
            aria-label="Move to top"
            onClick={() => onMove(catalog.id, catalog.type, 'top')}
          />
          <IconButton
            className={iconClass}
            icon={<LuChevronsDown />}
            intent="primary-subtle"
            rounded
            title="Move to bottom"
            aria-label="Move to bottom"
            onClick={() => onMove(catalog.id, catalog.type, 'bottom')}
          />
          <QuickToggles
            catalog={catalog}
            update={update}
            iconClass={iconClass}
          />
        </div>
        <Switch
          value={enabled}
          onValueChange={(value) =>
            onToggleEnabled(catalog.id, catalog.type, value)
          }
        />
        <IconButton
          rounded
          size="sm"
          intent="gray-subtle"
          icon={<LuSettings2 />}
          aria-label="Catalog settings"
          title="Settings"
          onClick={() => setSettingsOpen(true)}
        />
      </div>
      {settingsOpen && (
        <CatalogSettingsModal
          catalog={catalog}
          update={update}
          onMove={(to) => onMove(catalog.id, catalog.type, to)}
          onEditMerged={() => {
            setSettingsOpen(false);
            onEditMerged(catalog.id);
          }}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </>
  );
});

function QuickToggles({
  catalog,
  update,
  iconClass,
}: {
  catalog: CatalogModification;
  update: (fn: CatalogUpdate) => void;
  iconClass: string;
}) {
  const home = onHome(catalog);
  const toggle = (
    label: string,
    icon: React.ReactElement,
    onClick: () => void,
    disabled?: boolean
  ) => (
    <IconButton
      className={iconClass}
      icon={icon}
      intent="primary-subtle"
      rounded
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    />
  );
  return (
    <>
      {toggle(
        capitalise(orderState(catalog)),
        catalog.shuffle ? (
          <FaShuffle />
        ) : catalog.reverse ? (
          <FaArrowLeftLong />
        ) : (
          <FaArrowRightLong />
        ),
        () =>
          update((c) => {
            const next =
              catalogOrderStates[
                (catalogOrderStates.indexOf(orderState(c)) + 1) %
                  catalogOrderStates.length
              ];
            return {
              ...c,
              shuffle: next === 'shuffle',
              reverse: next === 'reverse',
            };
          })
      )}
      {toggle(
        'Poster Services',
        catalog.usePosterService ? <PiStarFill /> : <PiStarBold />,
        () => update((c) => ({ ...c, usePosterService: !c.usePosterService }))
      )}
      {(catalog.hideable || catalog.genreRequired) &&
        toggle(
          home ? 'On Home' : 'Discover Only',
          home ? <TbSmartHome /> : <TbSmartHomeOff />,
          () => update(home ? hideFromHome : showOnHome),
          catalog.onlyOnSearch
        )}
      {catalog.searchable &&
        toggle(
          catalog.onlyOnSearch
            ? 'Search Only'
            : catalog.disableSearch
              ? 'Search Disabled'
              : 'Searchable',
          catalog.onlyOnSearch ? (
            <MdSavedSearch />
          ) : catalog.disableSearch ? (
            <TbSearchOff />
          ) : (
            <TbSearch />
          ),
          () =>
            update((c) => {
              // cycles normal -> search only -> search disabled
              if (!c.onlyOnSearch && !c.disableSearch) {
                return {
                  ...c,
                  onlyOnSearch: true,
                  onlyOnDiscover: false,
                  showOnHome: false,
                };
              } else if (c.onlyOnSearch) {
                return { ...c, onlyOnSearch: false, disableSearch: true };
              } else {
                return { ...c, disableSearch: false };
              }
            })
        )}
    </>
  );
}

function CatalogSettingsModal({
  catalog,
  update,
  onMove,
  onEditMerged,
  onClose,
}: {
  catalog: CatalogModification;
  update: (fn: CatalogUpdate) => void;
  onMove: (to: 'top' | 'bottom') => void;
  onEditMerged: () => void;
  onClose: () => void;
}) {
  const merged = isMerged(catalog);
  const [newName, setNewName] = useState(catalog.name || '');
  const [newType, setNewType] = useState(
    catalog.overrideType || catalog.type || ''
  );
  const renamed =
    newName !== (catalog.name || '') ||
    newType !== (catalog.overrideType || catalog.type || '');

  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title={catalog.name ?? catalog.id}
      description={merged ? 'Merged catalog' : catalog.addonName}
    >
      <div className="space-y-4">
        {merged && (
          <Button
            className="w-full"
            intent="white"
            rounded
            leftIcon={<LuMerge />}
            onClick={onEditMerged}
          >
            Edit name and sources
          </Button>
        )}
        {!merged && (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!newType) {
                toast.error('Type cannot be empty');
                return;
              }
              update((c) => ({ ...c, name: newName, overrideType: newType }));
              toast.success('Name and type saved');
            }}
          >
            <TextInput
              label="Name"
              placeholder="Enter catalog name"
              value={newName}
              onValueChange={setNewName}
            />
            <TextInput
              label="Type"
              placeholder="Enter catalog type"
              value={newType}
              onValueChange={setNewType}
            />
            <Button
              className="w-full"
              type="submit"
              intent="white"
              rounded
              disabled={!renamed}
            >
              Save name and type
            </Button>
          </form>
        )}

        <div className="flex gap-2">
          <Button
            className="flex-1"
            intent="gray-outline"
            size="sm"
            rounded
            leftIcon={<LuChevronsUp />}
            onClick={() => onMove('top')}
          >
            Move to top
          </Button>
          <Button
            className="flex-1"
            intent="gray-outline"
            size="sm"
            rounded
            leftIcon={<LuChevronsDown />}
            onClick={() => onMove('bottom')}
          >
            Move to bottom
          </Button>
        </div>

        <div className="flex flex-col gap-4">
          <Switch
            label="Shuffle"
            help="Randomize the order of catalog items on each request"
            side="right"
            value={catalog.shuffle ?? false}
            onValueChange={(shuffle) =>
              update((c) => ({
                ...c,
                shuffle,
                reverse: shuffle ? false : c.reverse,
              }))
            }
          />
          <Switch
            label="Reverse Order"
            help="Reverse the order of catalog items"
            side="right"
            value={catalog.reverse ?? false}
            onValueChange={(reverse) =>
              update((c) => ({
                ...c,
                reverse,
                shuffle: reverse ? false : c.shuffle,
              }))
            }
          />
          <div className="flex flex-col gap-2 md:flex-row md:items-center">
            <div className="flex-1">
              <label className="text-sm font-medium">Persist Shuffle For</label>
              <p className="text-xs text-[--muted]">
                The amount of hours to keep a given shuffled catalog order
                before shuffling again. Defaults to 0 (Shuffle on every
                request).
              </p>
            </div>
            <div className="w-full md:w-32">
              <NumberInput
                value={catalog.persistShuffleFor ?? 0}
                min={0}
                step={1}
                max={24}
                onValueChange={(value) =>
                  update((c) => ({ ...c, persistShuffleFor: value }))
                }
              />
            </div>
          </div>
          <Switch
            label="Poster Services"
            help="Replace movie/show posters with posters from poster services (RPDB or TOP Posters) when supported"
            side="right"
            value={catalog.usePosterService ?? false}
            onValueChange={(usePosterService) =>
              update((c) => ({ ...c, usePosterService }))
            }
          />
          {catalog.hideable && (
            <Switch
              label="Discover Only"
              help="Hide this catalog from the home page and only show it on the Discover page"
              side="right"
              value={catalog.onlyOnDiscover ?? false}
              disabled={catalog.onlyOnSearch}
              onValueChange={(onlyOnDiscover) =>
                update((c) => ({
                  ...c,
                  onlyOnDiscover,
                  onlyOnSearch: onlyOnDiscover ? false : c.onlyOnSearch,
                }))
              }
            />
          )}
          {catalog.genreRequired && (
            <Switch
              label="Show on Home"
              help="This catalog needs a genre, so it only shows on the Discover page. Show it on the home page too, with its first genre picked"
              side="right"
              value={catalog.showOnHome ?? false}
              disabled={catalog.onlyOnSearch}
              onValueChange={(showOnHome) =>
                update((c) => ({
                  ...c,
                  showOnHome,
                  onlyOnSearch: showOnHome ? false : c.onlyOnSearch,
                }))
              }
            />
          )}
          {catalog.searchable && (
            <>
              <Switch
                label="Search Only"
                help="Only show this catalog when searching"
                side="right"
                value={catalog.onlyOnSearch ?? false}
                disabled={catalog.disableSearch}
                onValueChange={(onlyOnSearch) =>
                  update((c) => ({
                    ...c,
                    onlyOnSearch,
                    onlyOnDiscover: onlyOnSearch ? false : c.onlyOnDiscover,
                    showOnHome: onlyOnSearch ? false : c.showOnHome,
                  }))
                }
              />
              <Switch
                label="Disable Search"
                help="Disable the search for this catalog"
                side="right"
                value={catalog.disableSearch ?? false}
                onValueChange={(disableSearch) =>
                  update((c) => ({
                    ...c,
                    disableSearch,
                    onlyOnSearch: disableSearch ? false : c.onlyOnSearch,
                  }))
                }
              />
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
