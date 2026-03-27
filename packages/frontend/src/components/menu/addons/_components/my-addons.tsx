'use client';
import React, { useState, useEffect, useMemo } from 'react';
import { useUserData, removeInvalidPresetReferences } from '@/context/userData';
import { useStatus } from '@/context/status';
import { Option } from '@aiostreams/core';
import { SettingsCard } from '../../../shared/settings-card';
import { Button, IconButton } from '../../../ui/button';
import { Switch } from '../../../ui/switch';
import { Modal } from '../../../ui/modal';
import { TextInput } from '../../../ui/text-input';
import TemplateOption from '../../../shared/template-option';
import { useDisclosure } from '@/hooks/disclosure';
import { useMode } from '@/context/mode';
import { toast } from 'sonner';
import Image from 'next/image';
import { PlusIcon, SearchIcon } from 'lucide-react';
import { BiEdit, BiTrash } from 'react-icons/bi';
import {
  LuSettings,
  LuExternalLink,
  LuCircleCheck,
  LuArrowUpDown,
  LuSquareCheck,
  LuPencil,
  LuTrash2,
  LuTag,
  LuPower,
  LuPowerOff,
  LuArrowLeft,
} from 'react-icons/lu';
import { IoExtensionPuzzle } from 'react-icons/io5';
import { ReorderModal } from './reorder-modal';
import {
  ConfirmationDialog,
  useConfirmationDialog,
} from '../../../shared/confirmation-dialog';
import * as constants from '../../../../../../core/src/utils/constants';

const manifestCache = new Map<string, any>();

/** Colour palette available for custom categories */
const COLOUR_PALETTE = [
  {
    key: 'blue',
    bg: 'bg-blue-500/15',
    text: 'text-blue-400',
    border: 'border-blue-500/40',
    swatch: 'bg-blue-500',
  },
  {
    key: 'purple',
    bg: 'bg-purple-500/15',
    text: 'text-purple-400',
    border: 'border-purple-500/40',
    swatch: 'bg-purple-500',
  },
  {
    key: 'amber',
    bg: 'bg-amber-500/15',
    text: 'text-amber-400',
    border: 'border-amber-500/40',
    swatch: 'bg-amber-500',
  },
  {
    key: 'emerald',
    bg: 'bg-emerald-500/15',
    text: 'text-emerald-400',
    border: 'border-emerald-500/40',
    swatch: 'bg-emerald-500',
  },
  {
    key: 'rose',
    bg: 'bg-rose-500/15',
    text: 'text-rose-400',
    border: 'border-rose-500/40',
    swatch: 'bg-rose-500',
  },
  {
    key: 'cyan',
    bg: 'bg-cyan-500/15',
    text: 'text-cyan-400',
    border: 'border-cyan-500/40',
    swatch: 'bg-cyan-500',
  },
  {
    key: 'orange',
    bg: 'bg-orange-500/15',
    text: 'text-orange-400',
    border: 'border-orange-500/40',
    swatch: 'bg-orange-500',
  },
  {
    key: 'pink',
    bg: 'bg-pink-500/15',
    text: 'text-pink-400',
    border: 'border-pink-500/40',
    swatch: 'bg-pink-500',
  },
  {
    key: 'teal',
    bg: 'bg-teal-500/15',
    text: 'text-teal-400',
    border: 'border-teal-500/40',
    swatch: 'bg-teal-500',
  },
  {
    key: 'indigo',
    bg: 'bg-indigo-500/15',
    text: 'text-indigo-400',
    border: 'border-indigo-500/40',
    swatch: 'bg-indigo-500',
  },
  {
    key: 'lime',
    bg: 'bg-lime-500/15',
    text: 'text-lime-400',
    border: 'border-lime-500/40',
    swatch: 'bg-lime-500',
  },
  {
    key: 'red',
    bg: 'bg-red-500/15',
    text: 'text-red-400',
    border: 'border-red-500/40',
    swatch: 'bg-red-500',
  },
];

/** Default category colours keyed by PresetCategory */
const DEFAULT_CATEGORY_COLORS: Record<string, (typeof COLOUR_PALETTE)[0]> = {
  [constants.PresetCategory.STREAMS]: COLOUR_PALETTE[0], // blue
  [constants.PresetCategory.SUBTITLES]: COLOUR_PALETTE[1], // purple
  [constants.PresetCategory.META_CATALOGS]: COLOUR_PALETTE[2], // amber
  [constants.PresetCategory.MISC]: COLOUR_PALETTE[3], // emerald
};

const DEFAULT_CATEGORY_LABELS: Record<string, string> = {
  [constants.PresetCategory.STREAMS]: 'Streams',
  [constants.PresetCategory.SUBTITLES]: 'Subtitles',
  [constants.PresetCategory.META_CATALOGS]: 'Metadata & Catalogs',
  [constants.PresetCategory.MISC]: 'Miscellaneous',
};

function getDefaultCategory(
  presetType: string,
  presetMetadataMap: Map<string, any>
): string {
  const metadata = presetMetadataMap.get(presetType);
  return metadata?.CATEGORY || constants.PresetCategory.STREAMS;
}

function getEffectiveCategory(
  preset: any,
  presetMetadataMap: Map<string, any>
): string {
  return preset.category || getDefaultCategory(preset.type, presetMetadataMap);
}

function getCategoryColor(
  category: string,
  addonCategoryColors?: Record<string, string>
): (typeof COLOUR_PALETTE)[0] {
  // Check if it's a default category
  if (DEFAULT_CATEGORY_COLORS[category])
    return DEFAULT_CATEGORY_COLORS[category];
  // Check user-assigned colour
  const colourKey = addonCategoryColors?.[category];
  if (colourKey) {
    const found = COLOUR_PALETTE.find((c) => c.key === colourKey);
    if (found) return found;
  }
  // Hash-based fallback
  let hash = 0;
  for (let i = 0; i < category.length; i++) {
    hash = category.charCodeAt(i) + ((hash << 5) - hash);
  }
  return COLOUR_PALETTE[Math.abs(hash) % COLOUR_PALETTE.length];
}

export { manifestCache };

export function MyAddons({
  onEdit,
}: {
  onEdit: (preset: any, presetMetadata: any) => void;
}) {
  const { userData, setUserData } = useUserData();
  const { status } = useStatus();
  const { mode } = useMode();

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const reorderModal = useDisclosure(false);
  const batchEditModal = useDisclosure(false);
  const categoryModal = useDisclosure(false);

  // Batch edit state
  const [batchEditStep, setBatchEditStep] = useState<'pick' | 'edit'>('pick');
  const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set());
  const [batchValues, setBatchValues] = useState<Record<string, any>>({});

  // Category assignment state
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryColour, setNewCategoryColour] = useState('blue');

  // Build metadata map
  const presetMetadataMap = useMemo(() => {
    const map = new Map<string, any>();
    if (status?.settings?.presets) {
      for (const p of status.settings.presets) {
        map.set(p.ID, p);
      }
    }
    return map;
  }, [status]);

  // Collect all categories
  const allCategories = useMemo(() => {
    const cats = new Map<string, number>();
    for (const preset of userData.presets) {
      const cat = getEffectiveCategory(preset, presetMetadataMap);
      cats.set(cat, (cats.get(cat) || 0) + 1);
    }
    return cats;
  }, [userData.presets, presetMetadataMap]);

  const orderedCategories = useMemo(() => {
    const defaultOrder = [
      constants.PresetCategory.STREAMS,
      constants.PresetCategory.SUBTITLES,
      constants.PresetCategory.META_CATALOGS,
      constants.PresetCategory.MISC,
    ];
    const defaults = defaultOrder.filter((c) => allCategories.has(c));
    const customs = [...allCategories.keys()]
      .filter((c) => !defaultOrder.includes(c as any))
      .sort((a, b) => {
        const indexA = userData.presets.findIndex(
          (p) => getEffectiveCategory(p, presetMetadataMap) === a
        );
        const indexB = userData.presets.findIndex(
          (p) => getEffectiveCategory(p, presetMetadataMap) === b
        );
        return indexA - indexB;
      });
    return [...defaults, ...customs];
  }, [allCategories, userData.presets, presetMetadataMap]);

  // Filtered presets
  const filteredPresets = useMemo(() => {
    let result = userData.presets;
    if (categoryFilter !== 'all') {
      result = result.filter(
        (p) => getEffectiveCategory(p, presetMetadataMap) === categoryFilter
      );
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((p) =>
        (p.options?.name || '').toLowerCase().includes(q)
      );
    }
    return result;
  }, [userData.presets, presetMetadataMap, categoryFilter, search]);

  const groupedPresets = useMemo(() => {
    const groups: Record<string, any[]> = {};
    for (const preset of filteredPresets) {
      const cat = getEffectiveCategory(preset, presetMetadataMap);
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(preset);
    }
    return groups;
  }, [filteredPresets, presetMetadataMap]);

  const isAllSelected =
    filteredPresets.length > 0 &&
    filteredPresets.every((p) => selectedIds.has(p.instanceId));
  const hasSelection = selectedIds.size > 0;

  // toggle enables if more than 50% of selected presets are disabled and vice versa
  const toggleWillEnable = useMemo(() => {
    const selectedPresets = userData.presets.filter((p) =>
      selectedIds.has(p.instanceId)
    );
    const enabled = selectedPresets.filter((p: any) => p.enabled).length;
    const disabled = selectedPresets.filter((p: any) => !p.enabled).length;
    return disabled > enabled;
  }, [userData.presets, selectedIds]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredPresets.map((p) => p.instanceId)));
    }
  };

  // Only clear selection on filter/search change
  useEffect(() => {
    setSelectedIds(new Set());
  }, [categoryFilter, search]);

  // ── Common editable fields across selected presets ──
  const commonOptions = useMemo(() => {
    if (selectedIds.size === 0) return [];
    const selectedPresets = userData.presets.filter((p) =>
      selectedIds.has(p.instanceId)
    );
    const optionFrequency = new Map<
      string,
      { option: Option; count: number }
    >();
    for (const preset of selectedPresets) {
      const metadata = presetMetadataMap.get(preset.type);
      if (!metadata?.OPTIONS) continue;
      for (const opt of metadata.OPTIONS as Option[]) {
        if (['alert', 'socials', 'oauth', 'subsection'].includes(opt.type))
          continue;
        const existing = optionFrequency.get(opt.id);
        if (existing) existing.count++;
        else optionFrequency.set(opt.id, { option: opt, count: 1 });
      }
    }
    return [...optionFrequency.values()]
      .filter((v) => v.count === selectedPresets.length)
      .map((v) => v.option);
  }, [selectedIds, userData.presets, presetMetadataMap]);

  // ── Batch actions (do NOT clear selection) ──
  const batchToggleEnabled = () => {
    const enabled = toggleWillEnable;
    setUserData((prev) => ({
      ...prev,
      presets: prev.presets.map((p) =>
        selectedIds.has(p.instanceId) ? { ...p, enabled } : p
      ),
    }));
  };

  const confirmBatchDelete = useConfirmationDialog({
    title: 'Delete Selected Addons',
    description: `Are you sure you want to delete ${selectedIds.size} selected addon(s)? This cannot be undone.`,
    actionText: 'Delete',
    actionIntent: 'alert',
    onConfirm: () => {
      setUserData((prev) => {
        const cloned = structuredClone(prev);
        cloned.presets = cloned.presets.filter(
          (p) => !selectedIds.has(p.instanceId)
        );
        return removeInvalidPresetReferences(cloned);
      });
      setSelectedIds(new Set());
    },
  });

  const openBatchEdit = () => {
    setBatchEditStep('pick');
    setSelectedFields(new Set());
    setBatchValues({});
    batchEditModal.open();
  };

  const applyBatchEdit = () => {
    setUserData((prev) => ({
      ...prev,
      presets: prev.presets.map((p) => {
        if (!selectedIds.has(p.instanceId)) return p;
        const metadata = presetMetadataMap.get(p.type);
        const presetOptionIds = new Set(
          (metadata?.OPTIONS || []).map((o: Option) => o.id)
        );
        const newOptions = { ...p.options };
        for (const fieldId of selectedFields) {
          if (presetOptionIds.has(fieldId)) {
            newOptions[fieldId] = batchValues[fieldId];
          }
        }
        return { ...p, options: newOptions };
      }),
    }));
    batchEditModal.close();
  };

  const applyCategory = (category: string | undefined) => {
    setUserData((prev) => ({
      ...prev,
      presets: prev.presets.map((p) =>
        selectedIds.has(p.instanceId) ? { ...p, category } : p
      ),
    }));
    toast.info(
      category
        ? `Categorised ${selectedIds.size} addon(s) as "${category}"`
        : `Reset category for ${selectedIds.size} addon(s)`
    );
    categoryModal.close();
  };

  const applyCategoryWithColour = (name: string, colourKey: string) => {
    setUserData((prev) => ({
      ...prev,
      presets: prev.presets.map((p) =>
        selectedIds.has(p.instanceId) ? { ...p, category: name } : p
      ),
      addonCategoryColors: {
        ...(prev.addonCategoryColors || {}),
        [name]: colourKey,
      },
    }));
    toast.info(`Categorised ${selectedIds.size} addon(s) as "${name}"`);
    categoryModal.close();
    setNewCategoryName('');
  };

  const handleReorderSave = (newPresets: any[]) => {
    setUserData((prev) => ({ ...prev, presets: newPresets }));
  };

  const getCategoryLabel = (cat: string) => DEFAULT_CATEGORY_LABELS[cat] || cat;

  return (
    <>
      <SettingsCard
        title="My Addons"
        description="Manage your installed addons. Reorder, batch edit, or categorise by type."
        action={
          <div className="flex items-center gap-2">
            <IconButton
              rounded
              intent="primary-subtle"
              icon={<LuArrowUpDown className="w-5 h-5" />}
              onClick={() => reorderModal.open()}
              disabled={userData.presets.length < 2}
              title="Reorder Priority"
            />
            <IconButton
              rounded
              intent={isAllSelected ? 'primary' : 'primary-subtle'}
              icon={<LuSquareCheck className="w-5 h-5" />}
              onClick={toggleSelectAll}
              disabled={filteredPresets.length === 0}
              title={isAllSelected ? 'Deselect All' : 'Select All'}
            />
          </div>
        }
      >
        {/* ── Always-visible toolbar ── */}
        {userData.presets.length > 0 && (
          <div className="space-y-3 mb-4">
            {/* Row 1: Search bar + action icons (actions wrap to own row on mobile) */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex-1 min-w-[140px]">
                <TextInput
                  value={search}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setSearch(e.target.value)
                  }
                  placeholder="Search addons..."
                  leftIcon={<SearchIcon className="w-4 h-4" />}
                />
              </div>
              {hasSelection && (
                <div className="flex items-center gap-1.5 animate-in fade-in duration-150">
                  <span className="text-xs font-semibold text-[--brand] whitespace-nowrap">
                    {selectedIds.size} selected
                  </span>
                  <IconButton
                    size="sm"
                    rounded
                    intent="primary-subtle"
                    icon={
                      toggleWillEnable ? (
                        <LuPower className="w-3.5 h-3.5" />
                      ) : (
                        <LuPowerOff className="w-3.5 h-3.5" />
                      )
                    }
                    onClick={batchToggleEnabled}
                    title={
                      toggleWillEnable ? 'Enable selected' : 'Disable selected'
                    }
                  />
                  {mode === 'pro' && commonOptions.length > 0 && (
                    <IconButton
                      size="sm"
                      rounded
                      intent="primary-subtle"
                      icon={<LuPencil className="w-3.5 h-3.5" />}
                      onClick={openBatchEdit}
                      title="Edit common fields"
                    />
                  )}
                  <IconButton
                    size="sm"
                    rounded
                    intent="primary-subtle"
                    icon={<LuTag className="w-3.5 h-3.5" />}
                    onClick={() => categoryModal.open()}
                    title="Set category"
                  />
                  <IconButton
                    size="sm"
                    rounded
                    intent="alert-subtle"
                    icon={<LuTrash2 className="w-3.5 h-3.5" />}
                    onClick={() => confirmBatchDelete.open()}
                    title="Delete selected"
                  />
                </div>
              )}
            </div>

            {/* Row 2: Category pills (wraps naturally on mobile) */}
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setCategoryFilter('all')}
                className={`px-2.5 py-1 text-xs font-medium rounded-full border transition-colors ${
                  categoryFilter === 'all'
                    ? 'bg-[--brand]/20 text-[--brand] border-[--brand]/50'
                    : 'bg-transparent text-[--muted] border-[--border] hover:bg-[--subtle]'
                }`}
              >
                All ({userData.presets.length})
              </button>
              {orderedCategories.map((cat) => {
                const count = allCategories.get(cat) || 0;
                const colors = getCategoryColor(
                  cat,
                  userData.addonCategoryColors
                );
                return (
                  <button
                    key={cat}
                    onClick={() =>
                      setCategoryFilter(categoryFilter === cat ? 'all' : cat)
                    }
                    className={`px-2.5 py-1 text-xs font-medium rounded-full border transition-colors ${
                      categoryFilter === cat
                        ? `${colors.bg} ${colors.text} ${colors.border}`
                        : 'bg-transparent text-[--muted] border-[--border] hover:bg-[--subtle]'
                    }`}
                  >
                    {getCategoryLabel(cat)} ({count})
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Addon list ── */}
        {userData.presets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <span className="text-lg text-muted-foreground font-semibold text-center">
              Looks like you don't have any addons...
              <br />
              Add some from the marketplace!
            </span>
          </div>
        ) : filteredPresets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8">
            <span className="text-sm text-[--muted]">
              No addons match your search.
            </span>
          </div>
        ) : categoryFilter === 'all' && !search.trim() ? (
          <div className="space-y-4">
            {orderedCategories.map((cat) => {
              const presets = groupedPresets[cat];
              if (!presets || presets.length === 0) return null;
              const colors = getCategoryColor(
                cat,
                userData.addonCategoryColors
              );
              return (
                <div key={cat}>
                  <button
                    className="flex items-center gap-2 mb-2 group cursor-pointer"
                    onClick={() => {
                      const catIds = presets.map((p) => p.instanceId);
                      const allSelected = catIds.every((id) =>
                        selectedIds.has(id)
                      );
                      setSelectedIds((prev) => {
                        const next = new Set(prev);
                        for (const id of catIds) {
                          if (allSelected) next.delete(id);
                          else next.add(id);
                        }
                        return next;
                      });
                    }}
                    title={`Select all in ${getCategoryLabel(cat)}`}
                  >
                    <span
                      className={`inline-block w-2.5 h-2.5 rounded-full ${colors.swatch}`}
                    />
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-[--muted] group-hover:text-[--foreground] transition-colors">
                      {getCategoryLabel(cat)}
                    </h4>
                  </button>
                  <ul className="space-y-1.5">
                    {presets.map((preset) => (
                      <AddonListItem
                        key={preset.instanceId}
                        preset={preset}
                        presetMetadata={presetMetadataMap.get(preset.type)}
                        isSelected={selectedIds.has(preset.instanceId)}
                        onToggleSelect={() => toggleSelect(preset.instanceId)}
                        onEdit={() =>
                          onEdit(preset, presetMetadataMap.get(preset.type))
                        }
                        onRemove={() => {
                          setUserData((prev) => {
                            const cloned = structuredClone(prev);
                            cloned.presets = cloned.presets.filter(
                              (a) => a.instanceId !== preset.instanceId
                            );
                            return removeInvalidPresetReferences(cloned);
                          });
                        }}
                        onToggleEnabled={(v) => {
                          setUserData((prev) => ({
                            ...prev,
                            presets: prev.presets.map((p) =>
                              p.instanceId === preset.instanceId
                                ? { ...p, enabled: v }
                                : p
                            ),
                          }));
                        }}
                      />
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        ) : (
          <ul className="space-y-1.5">
            {filteredPresets.map((preset) => (
              <AddonListItem
                key={preset.instanceId}
                preset={preset}
                presetMetadata={presetMetadataMap.get(preset.type)}
                isSelected={selectedIds.has(preset.instanceId)}
                onToggleSelect={() => toggleSelect(preset.instanceId)}
                onEdit={() =>
                  onEdit(preset, presetMetadataMap.get(preset.type))
                }
                onRemove={() => {
                  setUserData((prev) => {
                    const cloned = structuredClone(prev);
                    cloned.presets = cloned.presets.filter(
                      (a) => a.instanceId !== preset.instanceId
                    );
                    return removeInvalidPresetReferences(cloned);
                  });
                }}
                onToggleEnabled={(v) => {
                  setUserData((prev) => ({
                    ...prev,
                    presets: prev.presets.map((p) =>
                      p.instanceId === preset.instanceId
                        ? { ...p, enabled: v }
                        : p
                    ),
                  }));
                }}
              />
            ))}
          </ul>
        )}
      </SettingsCard>

      {/* ── Reorder Modal ── */}
      <ReorderModal
        open={reorderModal.isOpen}
        onOpenChange={reorderModal.toggle}
        presets={userData.presets}
        presetMetadataMap={presetMetadataMap}
        manifestCache={manifestCache}
        onSave={handleReorderSave}
      />

      {/* ── Batch Edit Modal (two-step) ── */}
      <Modal
        open={batchEditModal.isOpen}
        onOpenChange={batchEditModal.toggle}
        title={
          batchEditStep === 'pick'
            ? 'Choose Fields to Edit'
            : 'Edit Selected Fields'
        }
      >
        {batchEditStep === 'pick' ? (
          <div className="space-y-4">
            <p className="text-sm text-[--muted]">
              Select which fields to update across {selectedIds.size} selected
              addon(s). Only fields common to all selected addons are shown.
            </p>
            <div className="space-y-1.5 max-h-[50vh] overflow-y-auto">
              {commonOptions.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => {
                    setSelectedFields((prev) => {
                      const next = new Set(prev);
                      if (next.has(opt.id)) next.delete(opt.id);
                      else next.add(opt.id);
                      return next;
                    });
                  }}
                  className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors flex items-center gap-3 ${
                    selectedFields.has(opt.id)
                      ? 'border-[--brand]/50 bg-[--brand]/10'
                      : 'border-[--border] hover:bg-[--subtle]'
                  }`}
                >
                  <div
                    className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                      selectedFields.has(opt.id)
                        ? 'bg-brand-600 border-brand-600'
                        : 'border-gray-500'
                    }`}
                  >
                    {selectedFields.has(opt.id) && (
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
                  <div>
                    <p className="text-sm font-medium">{opt.name}</p>
                    {opt.description && (
                      <p className="text-xs text-[--muted] line-clamp-1">
                        {opt.description}
                      </p>
                    )}
                  </div>
                </button>
              ))}
            </div>
            <Button
              className="w-full"
              disabled={selectedFields.size === 0}
              onClick={() => {
                const vals: Record<string, any> = {};
                for (const id of selectedFields) {
                  const opt = commonOptions.find((o) => o.id === id);
                  if (opt) vals[id] = opt.default ?? undefined;
                }
                setBatchValues(vals);
                setBatchEditStep('edit');
              }}
            >
              Continue ({selectedFields.size} field
              {selectedFields.size !== 1 ? 's' : ''})
            </Button>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              applyBatchEdit();
            }}
          >
            {[...selectedFields].map((fieldId) => {
              const opt = commonOptions.find((o) => o.id === fieldId);
              if (!opt) return null;
              return (
                <div key={fieldId}>
                  <TemplateOption
                    option={opt}
                    value={batchValues[fieldId]}
                    onChange={(v: any) =>
                      setBatchValues((prev) => ({ ...prev, [fieldId]: v }))
                    }
                    disabled={false}
                  />
                </div>
              );
            })}
            <div className="flex gap-2">
              <IconButton
                rounded
                intent="primary-subtle"
                icon={<LuArrowLeft className="w-4 h-4" />}
                onClick={() => setBatchEditStep('pick')}
                title="Back"
                type="button"
              />
              <Button className="flex-1" type="submit">
                Apply to {selectedIds.size} addon(s)
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* ── Category Assignment Modal ── */}
      <Modal
        open={categoryModal.isOpen}
        onOpenChange={categoryModal.toggle}
        title="Set Category"
      >
        <div className="space-y-4">
          <p className="text-sm text-[--muted]">
            Choose a category for the {selectedIds.size} selected addon(s), or
            create a new one.
          </p>

          <div className="space-y-1.5 max-h-[40vh] overflow-y-auto">
            <button
              onClick={() => applyCategory(undefined)}
              className="w-full text-left px-3 py-2 rounded-lg border border-[--border] hover:bg-[--subtle] transition-colors text-sm"
            >
              Reset to Default
            </button>
            {orderedCategories.map((cat) => {
              const colors = getCategoryColor(
                cat,
                userData.addonCategoryColors
              );
              return (
                <button
                  key={cat}
                  onClick={() => applyCategory(cat)}
                  className="w-full text-left px-3 py-2 rounded-lg border border-[--border] hover:bg-[--subtle] transition-colors flex items-center gap-2"
                >
                  <span
                    className={`inline-block w-3 h-3 rounded-full ${colors.swatch}`}
                  />
                  <span className="text-sm">{getCategoryLabel(cat)}</span>
                  <span className="text-xs text-[--muted] ml-auto">
                    {allCategories.get(cat) || 0}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Create new category */}
          <div className="pt-2 border-t border-[--border] space-y-3">
            <p className="text-xs font-medium text-[--muted] uppercase tracking-wide">
              New Category
            </p>
            <TextInput
              value={newCategoryName}
              onValueChange={setNewCategoryName}
              placeholder="e.g. Usenet, HTTP, Anime..."
            />
            {/* Colour picker */}
            <div className="flex flex-wrap gap-1.5">
              {COLOUR_PALETTE.map((colour) => (
                <button
                  key={colour.key}
                  onClick={() => setNewCategoryColour(colour.key)}
                  className={`w-6 h-6 rounded-full ${colour.swatch} transition-all ${
                    newCategoryColour === colour.key
                      ? 'ring-2 ring-offset-2 ring-offset-[--background] ring-white/60 scale-110'
                      : 'hover:scale-110'
                  }`}
                  title={colour.key}
                />
              ))}
            </div>
            <Button
              className="w-full"
              size="md"
              disabled={!newCategoryName.trim()}
              onClick={() => {
                applyCategoryWithColour(
                  newCategoryName.trim(),
                  newCategoryColour
                );
                setNewCategoryName('');
              }}
            >
              Create & Apply
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmationDialog {...confirmBatchDelete} />
    </>
  );
}

/** ── Individual addon list item ── */
function AddonListItem({
  preset,
  presetMetadata,
  isSelected,
  onToggleSelect,
  onEdit,
  onRemove,
  onToggleEnabled,
}: {
  preset: any;
  presetMetadata: any;
  isSelected: boolean;
  onToggleSelect: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onToggleEnabled: (v: boolean) => void;
}) {
  const { setUserData } = useUserData();
  const [isConfigurable, setIsConfigurable] = useState(false);
  const [logo, setLogo] = useState<string | undefined>(
    preset.logo || presetMetadata?.LOGO
  );
  const [step, setStep] = useState(1);
  const configModalOpen = useDisclosure(false);
  const [newManifestUrl, setNewManifestUrl] = useState('');
  const [loading, setLoading] = useState(false);

  const confirmDelete = useConfirmationDialog({
    title: 'Delete Addon',
    description: `Are you sure you want to delete "${preset.options?.name || 'this addon'}"?`,
    actionText: 'Delete',
    actionIntent: 'alert',
    onConfirm: onRemove,
  });

  const standardiseManifestUrl = (url: string) =>
    url.replace(/^stremio:\/\//, 'https://').replace(/\/$/, '');

  const getManifestUrl = (): string | undefined => {
    if (presetMetadata?.ID === 'custom' || presetMetadata?.ID === 'aiostreams')
      return preset.options.manifestUrl;
    const url = preset.options.url;
    if (!url) return undefined;
    try {
      const urlObj = new URL(url);
      if (urlObj.pathname.endsWith('/manifest.json')) return url;
    } catch {}
  };

  useEffect(() => {
    if (configModalOpen.isOpen) setStep(1);
  }, [configModalOpen.isOpen]);

  useEffect(() => {
    let active = true;
    const manifestUrl = getManifestUrl();
    if (manifestUrl) {
      const std = standardiseManifestUrl(manifestUrl);
      const cached = manifestCache.get(std);
      if (cached) {
        setIsConfigurable(cached.behaviorHints?.configurable === true);
        setLogo(cached.logo);
        return;
      }
      fetch(std)
        .then((r) => r.json())
        .then((manifest) => {
          manifestCache.set(std, manifest);
          if (active) {
            setIsConfigurable(manifest?.behaviorHints?.configurable === true);
            setLogo(manifest?.logo);
          }
        })
        .catch(() => {
          if (active) setIsConfigurable(false);
        });
    }
    return () => {
      active = false;
    };
  }, [presetMetadata?.ID, preset.options.manifestUrl, preset.options.url]);

  const handleManifestUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    const std = standardiseManifestUrl(newManifestUrl);
    if (!newManifestUrl) {
      toast.error('Please enter a new manifest URL');
      return;
    }
    if (!/^(https?|stremio):\/\/.+\/manifest\.json$/.test(std)) {
      toast.error('Please enter a valid manifest URL');
      return;
    }
    try {
      setLoading(true);
      const response = await fetch(std);
      if (!response.ok)
        throw new Error(`${response.status} ${response.statusText}`);
      await response.json();
    } catch (error: any) {
      toast.error(`Failed to fetch or parse manifest: ${error.message}`);
      setLoading(false);
      return;
    }
    setUserData((prev) => {
      const currentPreset = prev.presets.find(
        (p) => p.instanceId === preset.instanceId
      );
      if (!currentPreset) return prev;
      const options =
        presetMetadata?.ID === 'custom' || presetMetadata?.ID === 'aiostreams'
          ? { ...currentPreset.options, manifestUrl: std }
          : { ...currentPreset.options, url: std };
      return {
        ...prev,
        presets: prev.presets.map((p) =>
          p.instanceId === preset.instanceId ? { ...p, options } : p
        ),
      };
    });
    setNewManifestUrl('');
    configModalOpen.close();
    toast.success('Manifest URL updated successfully');
    setLoading(false);
  };

  const getConfigureUrl = () => {
    const manifestUrl = getManifestUrl();
    if (!manifestUrl) return '';
    return standardiseManifestUrl(manifestUrl).replace(
      /\/manifest\.json$/,
      '/configure'
    );
  };

  return (
    <li>
      <div
        className={`px-2.5 py-2 rounded-[--radius-md] border flex gap-2 sm:gap-3 items-center transition-colors ${
          isSelected
            ? 'border-brand-500/50 bg-brand-500/10'
            : 'bg-[var(--background)] border-[--border]'
        }`}
      >
        {/* Checkbox */}
        <button
          onClick={onToggleSelect}
          className="flex items-center justify-center flex-shrink-0"
        >
          <div
            className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
              isSelected
                ? 'bg-brand-600 border-brand-600'
                : 'border-gray-500 hover:border-gray-400'
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
        </button>

        {/* Logo */}
        <div className="relative flex-shrink-0 h-8 w-8 hidden sm:block">
          {logo ? (
            <Image
              src={logo}
              alt={presetMetadata?.NAME || ''}
              fill
              className="w-full h-full object-contain rounded-md"
            />
          ) : presetMetadata?.ID === 'custom' ? (
            <PlusIcon className="w-full h-full object-contain text-[--brand]" />
          ) : preset.options.name?.trim()?.[0] ? (
            <div className="w-full h-full flex items-center justify-center rounded-md bg-gray-950">
              <p className="text-lg font-bold">
                {preset.options.name?.trim()?.[0]?.toUpperCase() || '?'}
              </p>
            </div>
          ) : (
            <IoExtensionPuzzle className="w-full h-full object-contain text-[--brand]" />
          )}
        </div>

        {/* Name */}
        <p className="text-base line-clamp-1 truncate block flex-1 min-w-0">
          {preset.options.name}
        </p>

        {/* Actions */}
        <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
          <Switch
            value={preset.enabled ?? false}
            onValueChange={onToggleEnabled}
            className="h-5 w-9 md:h-6 md:w-11"
          />
          {isConfigurable && (
            <IconButton
              className="rounded-full h-8 w-8 md:h-10 md:w-10"
              icon={<LuSettings />}
              intent="primary-subtle"
              onClick={() => configModalOpen.open()}
            />
          )}
          <IconButton
            className="rounded-full h-8 w-8 md:h-10 md:w-10"
            icon={<BiEdit />}
            intent="primary-subtle"
            onClick={onEdit}
          />
          <IconButton
            className="rounded-full h-8 w-8 md:h-10 md:w-10"
            icon={<BiTrash />}
            intent="alert-subtle"
            onClick={() => confirmDelete.open()}
          />
        </div>
      </div>

      {/* Reconfigure modal */}
      <Modal
        open={configModalOpen.isOpen}
        onOpenChange={configModalOpen.toggle}
        title={
          <>
            <span className="mr-1.5">Reconfigure</span>
            <span className="font-semibold truncate overflow-hidden text-ellipsis">
              {preset.options.name}
            </span>
          </>
        }
        titleClass="truncate max-w-sm"
      >
        {step === 1 && (
          <div className="text-center space-y-4">
            <div className="mx-auto bg-[--subtle] rounded-full h-12 w-12 flex items-center justify-center">
              <LuExternalLink className="h-6 w-6 text-[--brand]" />
            </div>
            <h3 className="text-lg font-semibold">Reconfigure in a new tab</h3>
            <p className="text-sm text-[var(--muted-foreground)]">
              You'll be taken to a new tab to adjust your settings. Once
              finished, you will be given a new manifest URL to paste back here.
            </p>
            <Button
              className="w-full"
              onClick={() => {
                window.open(getConfigureUrl(), '_blank');
                setStep(2);
              }}
            >
              <span className="truncate">Take me to configuration</span>
            </Button>
          </div>
        )}
        {step === 2 && (
          <div className="space-y-4 max-w-md">
            <div className="text-center">
              <div className="mx-auto bg-[--subtle] rounded-full h-12 w-12 flex items-center justify-center">
                <LuCircleCheck className="h-6 w-6 text-[--brand]" />
              </div>
              <h3 className="text-lg font-semibold">Awaiting New URL</h3>
              <p className="text-sm text-[var(--muted-foreground)]">
                After adjusting your settings, copy the manifest URL and paste
                it below.
              </p>
            </div>
            <form onSubmit={handleManifestUpdate} className="space-y-4 pt-2">
              <TextInput
                type="url"
                label="New Manifest URL"
                placeholder="Paste your new URL here"
                value={newManifestUrl}
                onValueChange={setNewManifestUrl}
                required
                autoFocus
              />
              <div className="flex gap-2">
                <Button intent="primary-subtle" onClick={() => setStep(1)}>
                  Back
                </Button>
                <Button
                  loading={loading}
                  type="submit"
                  className="max-w-sm w-full text-ellipsis whitespace-nowrap overflow-hidden text-left"
                >
                  Update {preset.options.name}
                </Button>
              </div>
            </form>
          </div>
        )}
      </Modal>

      <ConfirmationDialog {...confirmDelete} />
    </li>
  );
}
