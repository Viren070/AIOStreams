'use client';
import React, { useState } from 'react';
import { CatalogModification } from '@aiostreams/core';
import { useUserData } from '@/context/userData';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { IconButton, Button } from '../../../ui/button';
import { Switch } from '../../../ui/switch';
import { Modal } from '../../../ui/modal';
import { TextInput } from '../../../ui/text-input';
import { NumberInput } from '../../../ui/number-input';
import { Tooltip } from '../../../ui/tooltip';
import {
  Accordion,
  AccordionTrigger,
  AccordionContent,
  AccordionItem,
} from '../../../ui/accordion';
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

export function SortableCatalogItem({
  catalog,
  onToggleEnabled,
  capitalise,
}: {
  catalog: CatalogModification;
  onToggleEnabled: (enabled: boolean) => void;
  capitalise: (str: string | undefined) => string;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: `${catalog.id}-${catalog.type}`,
  });

  const { setUserData } = useUserData();

  // Check if this is a merged catalog
  const isMergedCatalog = catalog.id.startsWith('aiostreams.merged.');

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const moveToTop = () => {
    setUserData((prev) => {
      if (!prev.catalogModifications) return prev;
      const index = prev.catalogModifications.findIndex(
        (c) => c.id === catalog.id && c.type === catalog.type
      );
      if (index <= 0) return prev;
      const newMods = [...prev.catalogModifications];
      const [item] = newMods.splice(index, 1);
      newMods.unshift(item);
      return { ...prev, catalogModifications: newMods };
    });
  };

  const moveToBottom = () => {
    setUserData((prev) => {
      if (!prev.catalogModifications) return prev;
      const index = prev.catalogModifications.findIndex(
        (c) => c.id === catalog.id && c.type === catalog.type
      );
      if (index === prev.catalogModifications.length - 1) return prev;
      const newMods = [...prev.catalogModifications];
      const [item] = newMods.splice(index, 1);
      newMods.push(item);
      return { ...prev, catalogModifications: newMods };
    });
  };

  const currentState = catalog.shuffle
    ? 'shuffle'
    : catalog.reverse
      ? 'reverse'
      : 'default';
  const catalogOrderStates = ['default', 'shuffle', 'reverse'];
  const cycleCatalogOrderState = () => {
    setUserData((prev) => {
      const currentModification = prev.catalogModifications?.find(
        (c) => c.id === catalog.id && c.type === catalog.type
      );
      if (!currentModification) return prev;
      const newState =
        catalogOrderStates[
          (catalogOrderStates.indexOf(currentState) + 1) %
            catalogOrderStates.length
        ];
      return {
        ...prev,
        catalogModifications: prev.catalogModifications?.map((c) =>
          c.id === catalog.id && c.type === catalog.type
            ? {
                ...c,
                shuffle: newState === 'shuffle',
                reverse: newState === 'reverse',
              }
            : c
        ),
      };
    });
  };

  const [modalOpen, setModalOpen] = useState(false);
  const [newName, setNewName] = useState(catalog.name || '');
  const [newType, setNewType] = useState(
    catalog.overrideType || catalog.type || ''
  );
  const dynamicIconSize = `text-xl h-8 w-8 lg:text-2xl lg:h-10 lg:w-10`;

  const handleNameAndTypeEdit = () => {
    if (!newType) {
      toast.error('Type cannot be empty');
      return;
    }
    setUserData((prev) => ({
      ...prev,
      catalogModifications: prev.catalogModifications?.map((c) =>
        c.id === catalog.id && c.type === catalog.type
          ? {
              ...c,
              name: newName,
              overrideType: newType,
            }
          : c
      ),
    }));
    setModalOpen(false);
  };

  return (
    <li ref={setNodeRef} style={style}>
      <div className="relative px-2.5 py-2 bg-[var(--background)] rounded-[--radius-md] border overflow-hidden">
        {/* Full-height drag handle - rounded vertical oval with spacing */}
        <div
          className={`absolute top-2 bottom-2 left-2 w-5 bg-[var(--muted)] md:bg-[var(--subtle)] md:hover:bg-[var(--subtle-highlight)] cursor-move flex-shrink-0 rounded-full`}
          {...{ ...attributes, ...listeners }}
        />

        {/* Content wrapper */}
        <div className="pl-8 pr-3 py-3">
          {/* Header section */}
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

            {/* Mobile Controls Row - only visible on small screens */}
            <div className="flex md:hidden items-center justify-between">
              {/* Position controls - aligned left */}

              <div className="flex items-center gap-1">
                <IconButton
                  rounded
                  className={dynamicIconSize}
                  icon={<LuChevronsUp />}
                  intent="primary-subtle"
                  onClick={moveToTop}
                  title="Move to top"
                />
                <IconButton
                  rounded
                  className={dynamicIconSize}
                  icon={<LuChevronsDown />}
                  intent="primary-subtle"
                  onClick={moveToBottom}
                  title="Move to bottom"
                />
              </div>

              {/* Enable/disable toggle */}
              <Switch
                value={catalog.enabled ?? true}
                onValueChange={onToggleEnabled}
                moreHelp="Enable or disable this catalog from being used"
              />
            </div>

            {/* Desktop Controls - only visible on medium screens and up */}
            <div className="hidden md:flex items-center justify-end gap-2 absolute top-4 right-4">
              <div className="flex items-center gap-1">
                <IconButton
                  rounded
                  icon={<LuChevronsUp />}
                  intent="primary-subtle"
                  onClick={moveToTop}
                  title="Move to top"
                />
                <IconButton
                  rounded
                  icon={<LuChevronsDown />}
                  intent="primary-subtle"
                  onClick={moveToBottom}
                  title="Move to bottom"
                />
              </div>
              <Switch
                value={catalog.enabled ?? true}
                onValueChange={onToggleEnabled}
                moreHelp="Enable or disable this catalog from being used"
              />
            </div>
          </div>{' '}
          {/* Settings section */}
          <Accordion type="single" collapsible>
            <AccordionItem value="settings">
              <AccordionTrigger>
                <div className="flex items-center justify-center md:justify-between w-full">
                  <h4 className="text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wide hidden md:block">
                    Settings
                  </h4>

                  {/* Active modifier icons */}
                  <div className="flex items-center gap-2 mr-2">
                    {/* Merged catalog indicator */}
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

                    {/* Shuffle/reverse toggle - hidden for merged catalogs */}
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

                    {/* RPDB toggle - hidden for merged catalogs */}
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
                            setUserData((prev) => ({
                              ...prev,
                              catalogModifications:
                                prev.catalogModifications?.map((c) =>
                                  c.id === catalog.id && c.type === catalog.type
                                    ? {
                                        ...c,
                                        usePosterService: !c.usePosterService,
                                      }
                                    : c
                                ),
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
                              setUserData((prev) => ({
                                ...prev,
                                catalogModifications:
                                  prev.catalogModifications?.map((c) =>
                                    c.id === catalog.id &&
                                    c.type === catalog.type
                                      ? {
                                          ...c,
                                          onlyOnDiscover: !c.onlyOnDiscover,
                                        }
                                      : c
                                  ),
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
                              setUserData((prev) => ({
                                ...prev,
                                catalogModifications:
                                  prev.catalogModifications?.map((c) => {
                                    if (
                                      c.id !== catalog.id ||
                                      c.type !== catalog.type
                                    )
                                      return c;
                                    // 3-state cycle: normal -> onlyOnSearch -> disableSearch -> normal
                                    if (!c.onlyOnSearch && !c.disableSearch) {
                                      // normal -> onlyOnSearch
                                      return {
                                        ...c,
                                        onlyOnSearch: true,
                                        onlyOnDiscover: false,
                                      };
                                    } else if (c.onlyOnSearch) {
                                      // onlyOnSearch -> disableSearch
                                      return {
                                        ...c,
                                        onlyOnSearch: false,
                                        disableSearch: true,
                                      };
                                    } else {
                                      // disableSearch -> normal
                                      return { ...c, disableSearch: false };
                                    }
                                  }),
                              }));
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
                  {/* Large screens: horizontal layout, Medium and below: vertical layout */}
                  <div className="flex flex-col gap-4">
                    {/* Shuffle/Reverse/RPDB settings - hidden for merged catalogs */}

                    <Switch
                      label="Shuffle"
                      help="Randomize the order of catalog items on each request"
                      side="right"
                      value={catalog.shuffle ?? false}
                      onValueChange={(shuffle) => {
                        setUserData((prev) => ({
                          ...prev,
                          catalogModifications: prev.catalogModifications?.map(
                            (c) =>
                              c.id === catalog.id && c.type === catalog.type
                                ? {
                                    ...c,
                                    shuffle,
                                    reverse: shuffle ? false : c.reverse,
                                  }
                                : c
                          ),
                        }));
                      }}
                    />

                    <Switch
                      label="Reverse Order"
                      help="Reverse the order of catalog items"
                      side="right"
                      value={catalog.reverse ?? false}
                      onValueChange={(reverse) => {
                        setUserData((prev) => ({
                          ...prev,
                          catalogModifications: prev.catalogModifications?.map(
                            (c) =>
                              c.id === catalog.id && c.type === catalog.type
                                ? {
                                    ...c,
                                    reverse,
                                    shuffle: reverse ? false : c.shuffle,
                                  }
                                : c
                          ),
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
                            setUserData((prev) => ({
                              ...prev,
                              catalogModifications:
                                prev.catalogModifications?.map((c) =>
                                  c.id === catalog.id && c.type === catalog.type
                                    ? { ...c, persistShuffleFor: value }
                                    : c
                                ),
                            }));
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
                        setUserData((prev) => ({
                          ...prev,
                          catalogModifications: prev.catalogModifications?.map(
                            (c) =>
                              c.id === catalog.id && c.type === catalog.type
                                ? { ...c, usePosterService }
                                : c
                          ),
                        }));
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
                          setUserData((prev) => ({
                            ...prev,
                            catalogModifications:
                              prev.catalogModifications?.map((c) =>
                                c.id === catalog.id && c.type === catalog.type
                                  ? {
                                      ...c,
                                      onlyOnDiscover,
                                      onlyOnSearch: onlyOnDiscover
                                        ? false
                                        : c.onlyOnSearch,
                                    }
                                  : c
                              ),
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
                            setUserData((prev) => ({
                              ...prev,
                              catalogModifications:
                                prev.catalogModifications?.map((c) =>
                                  c.id === catalog.id && c.type === catalog.type
                                    ? {
                                        ...c,
                                        onlyOnSearch,
                                        onlyOnDiscover: onlyOnSearch
                                          ? false
                                          : c.onlyOnDiscover,
                                      }
                                    : c
                                ),
                            }));
                          }}
                        />
                        <Switch
                          label="Disable Search"
                          help="Disable the search for this catalog"
                          side="right"
                          value={catalog.disableSearch ?? false}
                          onValueChange={(disableSearch) => {
                            setUserData((prev) => ({
                              ...prev,
                              catalogModifications:
                                prev.catalogModifications?.map((c) =>
                                  c.id === catalog.id && c.type === catalog.type
                                    ? {
                                        ...c,
                                        disableSearch,
                                        onlyOnSearch: disableSearch
                                          ? false
                                          : c.onlyOnSearch,
                                      }
                                    : c
                                ),
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

      {/* Name edit modal */}
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
    </li>
  );
}
