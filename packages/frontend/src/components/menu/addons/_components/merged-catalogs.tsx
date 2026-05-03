'use client';
import React, { useState } from 'react';
import { MergedCatalog } from '@aiostreams/core';
import { useStatus } from '@/context/status';
import { useUserData } from '@/context/userData';
import { SettingsCard } from '../../../shared/settings-card';
import { Button, CloseButton, IconButton } from '../../../ui/button';
import { Modal } from '../../../ui/modal';
import { TextInput } from '../../../ui/text-input';
import { Combobox } from '../../../ui/combobox';
import { Select } from '../../../ui/select';
import { Alert } from '../../../ui/alert';
import {
  ConfirmationDialog,
  useConfirmationDialog,
} from '../../../shared/confirmation-dialog';
import {
  Accordion,
  AccordionTrigger,
  AccordionContent,
  AccordionItem,
} from '../../../ui/accordion';
import { LuMerge } from 'react-icons/lu';
import { BiEdit, BiTrash } from 'react-icons/bi';
import { FaPlus } from 'react-icons/fa';
import { toast } from 'sonner';

export function MergedCatalogsCard() {
  const { userData, setUserData } = useUserData();
  const { status } = useStatus();
  const maxMergedCatalogSources =
    status?.settings?.limits?.maxMergedCatalogSources ?? 10;
  const [modalOpen, setModalOpen] = useState(false);
  const [editingMergedCatalog, setEditingMergedCatalog] =
    useState<MergedCatalog | null>(null);
  const [name, setName] = useState('');
  const [type, setType] = useState('movie');
  const [selectedCatalogs, setSelectedCatalogs] = useState<string[]>([]);
  const [dedupeMethods, setDedupeMethods] = useState<('id' | 'title')[]>([
    'id',
  ]);
  const [mergeMethod, setMergeMethod] =
    useState<MergedCatalog['mergeMethod']>('sequential');
  const [catalogSearch, setCatalogSearch] = useState('');
  const [expandedAddons, setExpandedAddons] = useState<Set<string>>(new Set());
  const [pendingDeleteMergedCatalogId, setPendingDeleteMergedCatalogId] =
    useState<string | null>(null);

  const confirmDeleteLastUnavailable = useConfirmationDialog({
    title: 'Delete Merged Catalog',
    description:
      'This is the last catalog in this merged catalog. Removing it will delete the entire merged catalog. Are you sure?',
    actionText: 'Delete Merged Catalog',
    actionIntent: 'alert',
    onConfirm: () => {
      if (pendingDeleteMergedCatalogId) {
        setUserData((prev) => ({
          ...prev,
          mergedCatalogs: prev.mergedCatalogs?.filter(
            (mc) => mc.id !== pendingDeleteMergedCatalogId
          ),
          catalogModifications: prev.catalogModifications?.filter(
            (mod) => mod.id !== pendingDeleteMergedCatalogId
          ),
        }));
        setPendingDeleteMergedCatalogId(null);
        toast.success('Merged catalog deleted');
      }
    },
  });

  const mergedCatalogs = userData.mergedCatalogs || [];

  const capitalise = (str: string | undefined) => {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
  };

  const allCatalogs = (userData.catalogModifications || [])
    .filter((c) => !c.id.startsWith('aiostreams.merged.')) // Exclude merged catalogs from being selected as sources
    .map((c) => ({
      value: `id=${encodeURIComponent(c.id)}&type=${encodeURIComponent(c.type)}`,
      name: c.name || c.id,
      catalogType: c.type,
      addonName: c.addonName || 'Unknown Addon',
      isDisabled: c.enabled === false,
    }));

  const catalogsByAddon = allCatalogs.reduce(
    (acc, catalog) => {
      if (!acc[catalog.addonName]) {
        acc[catalog.addonName] = [];
      }
      acc[catalog.addonName].push(catalog);
      return acc;
    },
    {} as Record<string, typeof allCatalogs>
  );

  const filteredCatalogsByAddon = Object.entries(catalogsByAddon).reduce(
    (acc, [addonName, catalogs]) => {
      const filtered = catalogs.filter(
        (c) =>
          c.name.toLowerCase().includes(catalogSearch.toLowerCase()) ||
          c.addonName.toLowerCase().includes(catalogSearch.toLowerCase()) ||
          c.catalogType.toLowerCase().includes(catalogSearch.toLowerCase())
      );
      if (filtered.length > 0) {
        // Sort by name, then by type
        const sorted = [...filtered].sort((a, b) => {
          const nameCompare = a.name.localeCompare(b.name);
          if (nameCompare !== 0) return nameCompare;
          return a.catalogType.localeCompare(b.catalogType);
        });
        acc[addonName] = sorted;
      }
      return acc;
    },
    {} as Record<string, typeof allCatalogs>
  );

  const toggleAddonExpanded = (addonName: string) => {
    setExpandedAddons((prev) => {
      const next = new Set(prev);
      if (next.has(addonName)) {
        next.delete(addonName);
      } else {
        next.add(addonName);
      }
      return next;
    });
  };

  const toggleCatalog = (catalogValue: string) => {
    setSelectedCatalogs((prev) => {
      if (prev.includes(catalogValue)) {
        return prev.filter((c) => c !== catalogValue);
      }
      // Prevent adding more than the limit
      if (prev.length >= maxMergedCatalogSources) {
        toast.error(
          `Maximum ${maxMergedCatalogSources} source catalogs allowed`
        );
        return prev;
      }
      return [...prev, catalogValue];
    });
  };

  const openAddModal = () => {
    setEditingMergedCatalog(null);
    setName('');
    setType('movie');
    setSelectedCatalogs([]);
    setDedupeMethods(['id']);
    setMergeMethod('sequential');
    setCatalogSearch('');
    setExpandedAddons(new Set());
    setModalOpen(true);
  };

  const openEditModal = (mergedCatalog: MergedCatalog) => {
    setEditingMergedCatalog(mergedCatalog);
    setName(mergedCatalog.name);
    setType(mergedCatalog.type);
    setSelectedCatalogs(mergedCatalog.catalogIds);
    setDedupeMethods(mergedCatalog.deduplicationMethods ?? ['id']);
    setMergeMethod(mergedCatalog.mergeMethod ?? 'sequential');
    setCatalogSearch('');
    setExpandedAddons(new Set());
    setModalOpen(true);
  };

  const handleSave = () => {
    if (!name.trim()) {
      toast.error('Name is required');
      return;
    }
    if (!type.trim()) {
      toast.error('Type is required');
      return;
    }
    if (selectedCatalogs.length < 2) {
      toast.error('Select at least 2 catalogs to merge');
      return;
    }
    if (selectedCatalogs.length > maxMergedCatalogSources) {
      toast.error(
        `Maximum ${maxMergedCatalogSources} source catalogs allowed per merged catalog`
      );
      return;
    }

    if (editingMergedCatalog) {
      setUserData((prev) => ({
        ...prev,
        catalogModifications: (prev.catalogModifications || []).map((mod) =>
          mod.id === editingMergedCatalog.id &&
          mod.type === editingMergedCatalog.type
            ? {
                ...mod,
                name: name.trim(),
                type: type.trim(),
              }
            : mod
        ),
        mergedCatalogs: (prev.mergedCatalogs || []).map((mc) =>
          mc.id === editingMergedCatalog.id
            ? {
                ...mc,
                name: name.trim(),
                type: type.trim(),
                catalogIds: selectedCatalogs,
                deduplicationMethods:
                  dedupeMethods.length > 0 ? dedupeMethods : undefined,
                mergeMethod: mergeMethod ?? 'sequential',
              }
            : mc
        ),
      }));
      toast.success('Merged catalog updated');
    } else {
      const newId = `aiostreams.merged.${Date.now()}`;
      setUserData((prev) => ({
        ...prev,
        mergedCatalogs: [
          ...(prev.mergedCatalogs || []),
          {
            id: newId,
            name: name.trim(),
            type: type.trim(),
            catalogIds: selectedCatalogs,
            enabled: true,
            deduplicationMethods:
              dedupeMethods.length > 0 ? dedupeMethods : undefined,
            mergeMethod: mergeMethod ?? 'sequential',
          },
        ],
      }));
      toast.success('Merged catalog created');
    }
    setModalOpen(false);
  };

  const handleDelete = (id: string) => {
    setUserData((prev) => ({
      ...prev,
      mergedCatalogs: (prev.mergedCatalogs || []).filter((mc) => mc.id !== id),
      catalogModifications: (prev.catalogModifications || []).filter(
        (mod) => mod.id !== id
      ),
    }));
    toast.success('Merged catalog deleted');
  };

  return (
    <SettingsCard
      title="Merged Catalogs"
      id="mergedCatalogs"
      description="Combine multiple catalogs into a single merged catalog. Useful for creating custom collections from different sources."
      action={
        <IconButton
          size="sm"
          intent="primary-subtle"
          icon={<FaPlus />}
          rounded
          onClick={openAddModal}
        />
      }
    >
      {mergedCatalogs.length === 0 && (
        <p className="text-[--muted] text-base text-center my-8">
          No merged catalogs yet. Click the + button to create one.
        </p>
      )}

      {mergedCatalogs.length > 0 && (
        <ul className="space-y-2">
          {mergedCatalogs.map((mc) => (
            <li key={mc.id}>
              <div className="relative px-4 py-3 bg-[var(--background)] rounded-[--radius-md] border overflow-hidden">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="flex items-center justify-center w-10 h-10 rounded-full bg-[var(--subtle)] flex-shrink-0">
                      <LuMerge className="text-xl" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm md:text-base font-medium truncate">
                        {mc.name}
                      </h3>
                      <p className="text-xs text-[var(--muted-foreground)]">
                        {capitalise(mc.type)} • {mc.catalogIds.length} catalogs
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <IconButton
                      className="h-8 w-8"
                      icon={<BiEdit />}
                      intent="primary-subtle"
                      rounded
                      onClick={() => openEditModal(mc)}
                    />
                    <IconButton
                      className="h-8 w-8"
                      icon={<BiTrash />}
                      intent="alert-subtle"
                      rounded
                      onClick={() => handleDelete(mc.id)}
                    />
                  </div>
                </div>

                {/* Settings accordion */}
                <Accordion type="single" collapsible className="mt-2">
                  <AccordionItem value="settings">
                    <AccordionTrigger>
                      <div className="flex items-center justify-center md:justify-between w-full">
                        <h4 className="text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wide hidden md:block">
                          Included Catalogs ({mc.catalogIds.length})
                        </h4>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="space-y-4">
                        {/* Included catalogs list */}
                        <div className="flex flex-wrap gap-1.5">
                          {mc.catalogIds.map((catalogId) => {
                            const catalog = allCatalogs.find(
                              (c) => c.value === catalogId
                            );
                            const isUnavailable = !catalog;
                            const availableCatalogsCount = mc.catalogIds.filter(
                              (id) => allCatalogs.find((c) => c.value === id)
                            ).length;
                            const isLastAvailable =
                              !isUnavailable && availableCatalogsCount === 1;
                            const isLastCatalog = mc.catalogIds.length === 1;

                            const handleRemove = (e: React.MouseEvent) => {
                              e.stopPropagation();
                              if (isLastAvailable) {
                                toast.error(
                                  'Cannot remove the last available catalog. Add another catalog first or delete the merged catalog.'
                                );
                                return;
                              }
                              if (isLastCatalog && isUnavailable) {
                                // Last catalog and it's unavailable - confirm deletion of merged catalog
                                setPendingDeleteMergedCatalogId(mc.id);
                                confirmDeleteLastUnavailable.open();
                                return;
                              }
                              // Normal removal
                              setUserData((prev) => ({
                                ...prev,
                                mergedCatalogs: prev.mergedCatalogs?.map(
                                  (merged) =>
                                    merged.id === mc.id
                                      ? {
                                          ...merged,
                                          catalogIds: merged.catalogIds.filter(
                                            (id) => id !== catalogId
                                          ),
                                        }
                                      : merged
                                ),
                              }));
                            };

                            return (
                              <span
                                key={catalogId}
                                className={`inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-md bg-[var(--subtle)] border border-[var(--border)] text-[var(--muted-foreground)] ${catalog?.isDisabled ? 'opacity-60' : ''} ${isUnavailable ? 'bg-orange-50 dark:bg-orange-500/10 border border-orange-300 dark:border-orange-500/50' : ''}`}
                              >
                                <span className="font-medium text-[var(--foreground)]">
                                  {catalog
                                    ? catalog.name
                                    : 'Unavailable Catalog'}
                                </span>
                                {catalog?.isDisabled && (
                                  <span className="text-[10px] px-1 py-0.5 rounded text-[--red]">
                                    Disabled
                                  </span>
                                )}
                                {catalog && (
                                  <span className="text-[10px] px-1 py-0.5 rounded bg-brand-800/20 border border-[--brand] border-brand-500/50 text-[--muted-foreground]">
                                    {capitalise(catalog.catalogType)}
                                  </span>
                                )}
                                <CloseButton
                                  type="button"
                                  className="ml-0.5"
                                  size="sm"
                                  onClick={handleRemove}
                                  title={
                                    isLastAvailable
                                      ? 'Cannot remove last available catalog'
                                      : 'Remove catalog'
                                  }
                                />
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Add/Edit Modal */}
      <Modal
        open={modalOpen}
        onOpenChange={setModalOpen}
        title={
          editingMergedCatalog ? 'Edit Merged Catalog' : 'Create Merged Catalog'
        }
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            handleSave();
          }}
        >
          <TextInput
            label="Name"
            placeholder="e.g., My Combined Movies"
            value={name}
            onValueChange={setName}
          />

          <TextInput
            label="Type"
            placeholder="e.g., movie, series, anime"
            help="The content type for this merged catalog (e.g., movie, series, anime, tv)"
            value={type}
            onValueChange={setType}
          />

          {/* Advanced Catalog Selector */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Catalogs to Merge</label>
              <span className="text-xs text-[--muted]">
                {selectedCatalogs.length} selected
              </span>
            </div>

            {/* Search */}
            <TextInput
              placeholder="Search catalogs..."
              value={catalogSearch}
              onValueChange={setCatalogSearch}
            />

            {/* Catalog list with collapsible addons */}
            <div className="border rounded-[--radius-md] h-64 overflow-y-auto">
              {Object.keys(filteredCatalogsByAddon).length === 0 ? (
                <p className="text-sm text-[--muted] text-center py-8">
                  {catalogSearch
                    ? 'No catalogs match your search'
                    : 'No catalogs available'}
                </p>
              ) : (
                Object.entries(filteredCatalogsByAddon).map(
                  ([addonName, catalogs]) => {
                    const isExpanded = expandedAddons.has(addonName);
                    return (
                      <div key={addonName} className="border-b last:border-b-0">
                        {/* Addon header - clickable to expand/collapse */}
                        <div
                          onClick={() => toggleAddonExpanded(addonName)}
                          className="px-3 py-2 bg-[var(--subtle)] cursor-pointer hover:bg-[var(--subtle-highlight)] flex items-center justify-between"
                        >
                          <div className="flex items-center gap-2">
                            <svg
                              className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={2}
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M9 5l7 7-7 7"
                              />
                            </svg>
                            <span className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wide">
                              {addonName}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-[var(--muted-foreground)]">
                              {catalogs.length} catalog
                              {catalogs.length !== 1 ? 's' : ''}
                            </span>
                          </div>
                        </div>
                        {/* Catalogs in this addon - shown only when expanded */}
                        {isExpanded &&
                          catalogs.map((catalog) => {
                            const isSelected = selectedCatalogs.includes(
                              catalog.value
                            );
                            return (
                              <div
                                key={catalog.value}
                                onClick={() => toggleCatalog(catalog.value)}
                                className={`flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors ${
                                  isSelected
                                    ? 'bg-[var(--brand-subtle)] hover:bg-[var(--brand-subtle)]'
                                    : 'hover:bg-[var(--subtle-highlight)]'
                                } ${catalog.isDisabled ? 'opacity-60' : ''}`}
                              >
                                <div
                                  className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                                    isSelected
                                      ? 'bg-[var(--brand)] border-[var(--brand)]'
                                      : 'border-[var(--muted)]'
                                  }`}
                                >
                                  {isSelected && (
                                    <svg
                                      className="w-3 h-3 text-white"
                                      fill="none"
                                      viewBox="0 0 24 24"
                                      stroke="currentColor"
                                      strokeWidth={3}
                                    >
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        d="M5 13l4 4L19 7"
                                      />
                                    </svg>
                                  )}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <span
                                    className={`text-sm font-medium truncate block ${catalog.isDisabled ? 'text-[var(--muted-foreground)]' : ''}`}
                                  >
                                    {catalog.name}
                                  </span>
                                </div>
                                <div className="flex items-center gap-1.5 flex-shrink-0">
                                  {catalog.isDisabled && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-orange-800/20 border border-orange-500/50 text-orange-300">
                                      Disabled
                                    </span>
                                  )}
                                  <span className="text-xs px-2 py-0.5 rounded-full text-[var(--muted-foreground)] bg-brand-800/20 border border-brand-500/50">
                                    {capitalise(catalog.catalogType)}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    );
                  }
                )
              )}
            </div>

            {/* Selected catalogs preview */}
            {selectedCatalogs.length > 0 && (
              <>
                {/* Show unavailable catalogs that can be removed */}
                {(() => {
                  const unavailableCatalogs = selectedCatalogs.filter(
                    (id) => !allCatalogs.find((c) => c.value === id)
                  );
                  if (unavailableCatalogs.length === 0) return null;
                  return (
                    <div className="p-3 rounded-[--radius] bg-orange-50 dark:bg-orange-500/10 border border-orange-300 dark:border-orange-500/50">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm text-orange-700 dark:text-orange-300">
                          {unavailableCatalogs.length} unavailable catalog
                          {unavailableCatalogs.length !== 1 ? 's' : ''} found
                        </p>
                        <Button
                          type="button"
                          size="sm"
                          intent="warning"
                          onClick={() =>
                            setSelectedCatalogs((prev) =>
                              prev.filter((id) =>
                                allCatalogs.find((c) => c.value === id)
                              )
                            )
                          }
                        >
                          Remove All
                        </Button>
                      </div>
                    </div>
                  );
                })()}
                <div className="text-xs text-[--muted]">
                  Selected ({selectedCatalogs.length}/{maxMergedCatalogSources}
                  ):{' '}
                  {selectedCatalogs
                    .filter((id) => allCatalogs.find((c) => c.value === id))
                    .slice(0, 3)
                    .map((id) => {
                      const cat = allCatalogs.find((c) => c.value === id);
                      return cat?.name || id;
                    })
                    .join(', ')}
                  {selectedCatalogs.filter((id) =>
                    allCatalogs.find((c) => c.value === id)
                  ).length > 3 &&
                    ` +${
                      selectedCatalogs.filter((id) =>
                        allCatalogs.find((c) => c.value === id)
                      ).length - 3
                    } more`}
                </div>
              </>
            )}
          </div>

          <Combobox
            multiple
            label="Deduplication Methods"
            help="Methods to remove duplicate items (applied in order). Leave empty to keep all items."
            options={[
              { value: 'id', label: 'By ID - Remove items with same ID' },
              {
                value: 'title',
                label: 'By Title - Remove items with same title',
              },
            ]}
            value={dedupeMethods}
            onValueChange={(v) => setDedupeMethods(v as ('id' | 'title')[])}
            placeholder="None - Keep all items"
            emptyMessage="No deduplication methods available"
          />

          <Select
            label="Merge Method"
            help="How to combine results from the source catalogs."
            options={[
              {
                value: 'sequential',
                label: 'Sequential',
              },
              {
                value: 'interleave',
                label: 'Interleave',
              },
              {
                value: 'imdbRating',
                label: 'IMDb Rating',
              },
              {
                value: 'releaseDateDesc',
                label: 'Release Date (Newest)',
              },
              {
                value: 'releaseDateAsc',
                label: 'Release Date (Oldest)',
              },
            ]}
            value={mergeMethod ?? 'sequential'}
            onValueChange={(v) =>
              setMergeMethod(v as MergedCatalog['mergeMethod'])
            }
          />

          {(mergeMethod === 'imdbRating' ||
            mergeMethod === 'releaseDateDesc' ||
            mergeMethod === 'releaseDateAsc') && (
            <Alert
              intent="alert"
              description="Sorting is applied per page only. Items are sorted within each page of results, not globally across all pages. A lower-rated item from page 1 may still appear before a higher-rated item from page 2."
            />
          )}

          <Button className="w-full" type="submit">
            {editingMergedCatalog ? 'Save Changes' : 'Create Merged Catalog'}
          </Button>
        </form>
      </Modal>
      <ConfirmationDialog {...confirmDeleteLastUnavailable} />
    </SettingsCard>
  );
}
