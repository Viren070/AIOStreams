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
import { Modal } from '@aiostreams/ui/modal';
import { TextInput } from '@aiostreams/ui/text-input';
import { NumberInput } from '@aiostreams/ui/number-input';
import { Tooltip } from '@aiostreams/ui/tooltip';
import {
  Accordion,
  AccordionTrigger,
  AccordionContent,
  AccordionItem,
} from '@aiostreams/ui/accordion';
import { BiEdit } from 'react-icons/bi';
import { LuChevronsUp, LuChevronsDown, LuMerge } from 'react-icons/lu';
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

export type CatalogUpdate = (
  catalog: CatalogModification
) => CatalogModification;

const capitalise = (str: string | undefined) =>
  str ? str.charAt(0).toUpperCase() + str.slice(1) : '';

const catalogOrderStates = ['default', 'shuffle', 'reverse'] as const;
const orderState = (c: CatalogModification) =>
  c.shuffle ? 'shuffle' : c.reverse ? 'reverse' : 'default';

// Keyed by id and type so the parent can pass the same callbacks to every row.
interface CatalogItemProps {
  catalog: CatalogModification;
  onUpdate: (id: string, type: string, update: CatalogUpdate) => void;
  onMove: (id: string, type: string, to: 'top' | 'bottom') => void;
  onToggleEnabled: (id: string, type: string, enabled: boolean) => void;
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
  } = useSortable({
    id: `${props.catalog.id}-${props.catalog.type}`,
  });

  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
    >
      <CatalogItemBody
        {...props}
        attributes={attributes}
        listeners={listeners}
      />
    </li>
  );
});

const CatalogItemBody = memo(function CatalogItemBody({
  catalog,
  onUpdate,
  onMove,
  onToggleEnabled,
  attributes,
  listeners,
}: CatalogItemProps & {
  attributes: DraggableAttributes;
  listeners: DraggableSyntheticListeners;
}) {
  const isMergedCatalog = catalog.id.startsWith('aiostreams.merged.');

  const update = (fn: CatalogUpdate) => onUpdate(catalog.id, catalog.type, fn);
  const moveToTop = () => onMove(catalog.id, catalog.type, 'top');
  const moveToBottom = () => onMove(catalog.id, catalog.type, 'bottom');
  const toggleEnabled = (enabled: boolean) =>
    onToggleEnabled(catalog.id, catalog.type, enabled);

  const currentState = orderState(catalog);
  const cycleCatalogOrderState = () => {
    update((c) => {
      const newState =
        catalogOrderStates[
          (catalogOrderStates.indexOf(orderState(c)) + 1) %
            catalogOrderStates.length
        ];
      return {
        ...c,
        shuffle: newState === 'shuffle',
        reverse: newState === 'reverse',
      };
    });
  };

  const [modalOpen, setModalOpen] = useState(false);
  const [newName, setNewName] = useState(catalog.name || '');
  const [newType, setNewType] = useState(
    catalog.overrideType || catalog.type || ''
  );
  const controlIconSize = 'text-xl h-8 w-8 md:text-2xl md:h-10 md:w-10';

  const handleNameAndTypeEdit = () => {
    if (!newType) {
      toast.error('Type cannot be empty');
      return;
    }
    update((c) => ({ ...c, name: newName, overrideType: newType }));
    setModalOpen(false);
  };

  return (
    <>
      <div className="relative px-2.5 py-2 bg-[var(--background)] rounded-[--radius-md] border overflow-hidden">
        <div
          className={`absolute top-2 bottom-2 left-2 w-5 bg-[var(--muted)] md:bg-[var(--subtle)] md:hover:bg-[var(--subtle-highlight)] cursor-move flex-shrink-0 rounded-full`}
          {...{ ...attributes, ...listeners }}
        />

        <div className="pl-8 pr-3 py-3">
          <div className="mb-4 md:mb-6 md:pr-40">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-sm md:text-base font-medium line-clamp-1 truncate text-ellipsis">
                {catalog.name ?? catalog.id} -{' '}
                {capitalise(catalog.overrideType ?? catalog.type)}
              </h3>
              {!isMergedCatalog && (
                <IconButton
                  className="rounded-full h-5 w-5 md:h-6 md:w-6 flex-shrink-0"
                  icon={<BiEdit />}
                  intent="primary-subtle"
                  onClick={() => setModalOpen(true)}
                />
              )}
            </div>
            <p className="text-xs md:text-sm text-[var(--muted-foreground)] mb-2 md:mb-0">
              {isMergedCatalog ? 'Merged Catalog' : catalog.addonName}
            </p>

            <div className="flex items-center justify-between md:justify-end md:gap-2 md:absolute md:top-4 md:right-4">
              <div className="flex items-center gap-1">
                <IconButton
                  rounded
                  className={controlIconSize}
                  icon={<LuChevronsUp />}
                  intent="primary-subtle"
                  onClick={moveToTop}
                  title="Move to top"
                />
                <IconButton
                  rounded
                  className={controlIconSize}
                  icon={<LuChevronsDown />}
                  intent="primary-subtle"
                  onClick={moveToBottom}
                  title="Move to bottom"
                />
              </div>
              <Switch
                value={catalog.enabled ?? true}
                onValueChange={toggleEnabled}
                moreHelp="Enable or disable this catalog from being used"
              />
            </div>
          </div>{' '}
          <Accordion type="single" collapsible>
            <AccordionItem value="settings">
              <AccordionTrigger>
                <div className="flex items-center justify-center md:justify-between w-full">
                  <h4 className="text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wide hidden md:block">
                    Settings
                  </h4>

                  <div className="flex items-center gap-2 mr-2">
                    {isMergedCatalog && (
                      <Tooltip
                        trigger={
                          <div className="flex items-center justify-center h-10 w-10 rounded-full bg-[var(--brand-subtle)]">
                            <LuMerge className="text-xl text-[var(--brand)]" />
                          </div>
                        }
                      >
                        Merged Catalog
                      </Tooltip>
                    )}

                    <Tooltip
                      trigger={
                        <IconButton
                          className="text-2xl h-10 w-10"
                          icon={
                            catalog.shuffle ? (
                              <FaShuffle />
                            ) : catalog.reverse ? (
                              <FaArrowLeftLong />
                            ) : (
                              <FaArrowRightLong />
                            )
                          }
                          intent="primary-subtle"
                          rounded
                          onClick={(e) => {
                            e.stopPropagation();
                            cycleCatalogOrderState();
                          }}
                        />
                      }
                    >
                      {currentState.charAt(0).toUpperCase() +
                        currentState.slice(1)}
                    </Tooltip>

                    <Tooltip
                      trigger={
                        <IconButton
                          className="text-2xl h-10 w-10"
                          icon={
                            catalog.usePosterService ? (
                              <PiStarFill />
                            ) : (
                              <PiStarBold />
                            )
                          }
                          intent="primary-subtle"
                          rounded
                          onClick={(e) => {
                            e.stopPropagation();
                            update((c) => ({
                              ...c,
                              usePosterService: !c.usePosterService,
                            }));
                          }}
                        />
                      }
                    >
                      Poster Services
                    </Tooltip>

                    {catalog.hideable && (
                      <Tooltip
                        trigger={
                          <IconButton
                            className="text-2xl h-10 w-10"
                            icon={
                              catalog.onlyOnDiscover ? (
                                <TbSmartHomeOff />
                              ) : (
                                <TbSmartHome />
                              )
                            }
                            disabled={catalog.onlyOnSearch}
                            intent="primary-subtle"
                            rounded
                            onClick={(e) => {
                              e.stopPropagation();
                              update((c) => ({
                                ...c,
                                onlyOnDiscover: !c.onlyOnDiscover,
                              }));
                            }}
                          />
                        }
                      >
                        Discover Only
                      </Tooltip>
                    )}

                    {catalog.searchable && (
                      <Tooltip
                        trigger={
                          <IconButton
                            className="text-2xl h-10 w-10"
                            icon={
                              catalog.onlyOnSearch ? (
                                <MdSavedSearch />
                              ) : catalog.disableSearch ? (
                                <TbSearchOff />
                              ) : (
                                <TbSearch />
                              )
                            }
                            intent="primary-subtle"
                            rounded
                            onClick={(e) => {
                              e.stopPropagation();
                              update((c) => {
                                // cycles normal -> search only -> search disabled
                                if (!c.onlyOnSearch && !c.disableSearch) {
                                  return {
                                    ...c,
                                    onlyOnSearch: true,
                                    onlyOnDiscover: false,
                                  };
                                } else if (c.onlyOnSearch) {
                                  return {
                                    ...c,
                                    onlyOnSearch: false,
                                    disableSearch: true,
                                  };
                                } else {
                                  return { ...c, disableSearch: false };
                                }
                              });
                            }}
                          />
                        }
                      >
                        {catalog.onlyOnSearch
                          ? 'Search Only'
                          : catalog.disableSearch
                            ? 'Search Disabled'
                            : 'Searchable'}
                      </Tooltip>
                    )}
                  </div>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-4">
                  <div className="flex flex-col gap-4">
                    <Switch
                      label="Shuffle"
                      help="Randomize the order of catalog items on each request"
                      side="right"
                      value={catalog.shuffle ?? false}
                      onValueChange={(shuffle) => {
                        update((c) => ({
                          ...c,
                          shuffle,
                          reverse: shuffle ? false : c.reverse,
                        }));
                      }}
                    />

                    <Switch
                      label="Reverse Order"
                      help="Reverse the order of catalog items"
                      side="right"
                      value={catalog.reverse ?? false}
                      onValueChange={(reverse) => {
                        update((c) => ({
                          ...c,
                          reverse,
                          shuffle: reverse ? false : c.shuffle,
                        }));
                      }}
                    />

                    <div className="flex flex-col md:flex-row md:items-center gap-2 -mx-2 px-2 hover:bg-[var(--subtle-highlight)] rounded-md">
                      <div className="flex-1 py-2">
                        <label className="text-sm font-medium">
                          Persist Shuffle For
                        </label>
                        <p className="text-xs text-[--muted]">
                          The amount of hours to keep a given shuffled catalog
                          order before shuffling again. Defaults to 0 (Shuffle
                          on every request).
                        </p>
                      </div>
                      <div className="w-full md:w-32 py-2">
                        <NumberInput
                          value={catalog.persistShuffleFor ?? 0}
                          min={0}
                          step={1}
                          max={24}
                          onValueChange={(value) => {
                            update((c) => ({ ...c, persistShuffleFor: value }));
                          }}
                        />
                      </div>
                    </div>

                    <Switch
                      label="Poster Services"
                      help="Replace movie/show posters with posters from poster services (RPDB or TOP Posters) when supported"
                      side="right"
                      value={catalog.usePosterService ?? false}
                      onValueChange={(usePosterService) => {
                        update((c) => ({ ...c, usePosterService }));
                      }}
                    />

                    {catalog.hideable && (
                      <Switch
                        label="Discover Only"
                        help="Hide this catalog from the home page and only show it on the Discover page"
                        side="right"
                        value={catalog.onlyOnDiscover ?? false}
                        disabled={catalog.onlyOnSearch}
                        onValueChange={(onlyOnDiscover) => {
                          update((c) => ({
                            ...c,
                            onlyOnDiscover,
                            onlyOnSearch: onlyOnDiscover
                              ? false
                              : c.onlyOnSearch,
                          }));
                        }}
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
                          onValueChange={(onlyOnSearch) => {
                            update((c) => ({
                              ...c,
                              onlyOnSearch,
                              onlyOnDiscover: onlyOnSearch
                                ? false
                                : c.onlyOnDiscover,
                            }));
                          }}
                        />
                        <Switch
                          label="Disable Search"
                          help="Disable the search for this catalog"
                          side="right"
                          value={catalog.disableSearch ?? false}
                          onValueChange={(disableSearch) => {
                            update((c) => ({
                              ...c,
                              disableSearch,
                              onlyOnSearch: disableSearch
                                ? false
                                : c.onlyOnSearch,
                            }));
                          }}
                        />
                      </>
                    )}
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </div>

      <Modal
        open={modalOpen}
        onOpenChange={setModalOpen}
        title="Edit Catalog Name"
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            handleNameAndTypeEdit();
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

          <Button className="w-full" type="submit">
            Save Changes
          </Button>
        </form>
      </Modal>
    </>
  );
});
