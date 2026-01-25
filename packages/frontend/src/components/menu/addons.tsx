'use client';
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { MergedCatalog, CatalogModification } from '@aiostreams/core';
import { PageWrapper } from '../shared/page-wrapper';
import { useStatus } from '@/context/status';
import { useUserData } from '@/context/userData';
import { SettingsCard } from '../shared/settings-card';
import { Button, CloseButton, IconButton } from '../ui/button';
import { Modal } from '../ui/modal';
import { Switch } from '../ui/switch';
import { Card } from '../ui/card';
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
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { PlusIcon, SearchIcon, FilterIcon } from 'lucide-react';
import TemplateOption from '../shared/template-option';
import * as constants from '../../../../core/src/utils/constants';
import { TextInput } from '../ui/text-input';
import { MdSubtitles, MdOutlineDataset, MdSavedSearch } from 'react-icons/md';
import { RiFolderDownloadFill } from 'react-icons/ri';

import { Popover } from '../ui/popover';
import { BiEdit, BiTrash } from 'react-icons/bi';
import { Option, Resource } from '@aiostreams/core';
import { toast } from 'sonner';
import { Tooltip } from '../ui/tooltip';
import { StaticTabs } from '../ui/tabs';
import {
  LuDownload,
  LuGlobe,
  LuChevronsUp,
  LuChevronsDown,
  LuShuffle,
  LuSettings,
  LuExternalLink,
  LuCircleCheck,
  LuMerge,
} from 'react-icons/lu';
import {
  TbSearch,
  TbSearchOff,
  TbSmartHome,
  TbSmartHomeOff,
} from 'react-icons/tb';
import { AnimatePresence } from 'framer-motion';
import { PageControls } from '../shared/page-controls';
import Image from 'next/image';
import { Combobox } from '../ui/combobox';
import { FaPlus, FaRegTrashAlt, FaArrowUp, FaArrowDown } from 'react-icons/fa';
import { UserConfigAPI } from '../../services/api';
import {
  ConfirmationDialog,
  useConfirmationDialog,
} from '../shared/confirmation-dialog';
import { MdRefresh } from 'react-icons/md';
import { Alert } from '../ui/alert';
import MarkdownLite from '../shared/markdown-lite';
import {
  Accordion,
  AccordionTrigger,
  AccordionContent,
  AccordionItem,
} from '../ui/accordion';
import { FaArrowLeftLong, FaArrowRightLong, FaShuffle } from 'react-icons/fa6';
import { PiStarFill, PiStarBold } from 'react-icons/pi';
import { IoExtensionPuzzle } from 'react-icons/io5';
import { NumberInput } from '../ui/number-input';
import { useDisclosure } from '@/hooks/disclosure';
import { useMode } from '@/context/mode';
import { Select } from '../ui/select';

export function AddonsMenu() {
  return (
    <PageWrapper className="space-y-4 p-4 sm:p-8">
      <Content />
    </PageWrapper>
  );
}

const manifestCache = new Map<string, any>();

function Content() {
  const { status } = useStatus();
  const { mode } = useMode();
  const { userData, setUserData } = useUserData();
  const [page, setPage] = useState<'installed' | 'marketplace'>('installed');
  const [search, setSearch] = useState('');
  // Filter states
  const [categoryFilter, setCategoryFilter] = useState<
    constants.PresetCategory | 'all'
  >('all');
  const [serviceFilter, setServiceFilter] = useState<string>('all');
  const [streamTypeFilter, setStreamTypeFilter] = useState<string>('all');
  // Modal states
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'add' | 'edit'>('add');
  const [modalPreset, setModalPreset] = useState<any | null>(null);
  const [modalInitialValues, setModalInitialValues] = useState<
    Record<string, any>
  >({});
  const [editingAddonId, setEditingAddonId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  // Filtering and search for marketplace
  const filteredPresets = useMemo(() => {
    if (!status?.settings?.presets) return [];
    let filtered = [
      ...status.settings.presets.filter((n) => !n.DISABLED?.removed),
    ];
    if (categoryFilter !== 'all') {
      filtered = filtered.filter(
        (n) =>
          (n.CATEGORY || constants.PresetCategory.STREAMS) === categoryFilter
      );
    }
    if (serviceFilter !== 'all') {
      filtered = filtered.filter(
        (n) =>
          n.SUPPORTED_SERVICES && n.SUPPORTED_SERVICES.includes(serviceFilter)
      );
    }
    if (streamTypeFilter !== 'all') {
      filtered = filtered.filter(
        (n) =>
          n.SUPPORTED_STREAM_TYPES &&
          n.SUPPORTED_STREAM_TYPES.includes(streamTypeFilter as any)
      );
    }
    if (search) {
      filtered = filtered.filter(
        (n) =>
          n.NAME.toLowerCase().includes(search.toLowerCase()) ||
          n.DESCRIPTION.toLowerCase().includes(search.toLowerCase())
      );
    }
    return filtered;
  }, [status, search, categoryFilter, serviceFilter, streamTypeFilter]);

  // My Addons (user's enabled/added presets)

  // AddonModal handlers
  function handleAddPreset(preset: any) {
    setModalPreset(preset);
    setModalInitialValues({
      options: Object.fromEntries(
        (preset.OPTIONS || []).map((opt: any) => [
          opt.id,
          opt.forced ?? opt.default ?? undefined,
        ])
      ),
    });
    setModalMode('add');
    setEditingAddonId(null);
    setModalOpen(true);
  }
  function getUniqueId() {
    // generate a 3 character long hex string, ensuring it doesn't already exist in the user's presets
    const id = Math.floor(Math.random() * 0xfff)
      .toString(16)
      .padStart(3, '0');
    if (userData.presets.some((a) => a.instanceId === id)) {
      return getUniqueId();
    }
    return id;
  }

  function handleModalSubmit(values: Record<string, any>) {
    if (modalMode === 'add' && modalPreset) {
      // Always add a new preset with default values, never edit
      const newPreset = {
        type: modalPreset.ID,
        instanceId: getUniqueId(),
        enabled: true,
        options: values.options,
      };
      const newKey = getPresetUniqueKey(newPreset);
      // Prevent adding if a preset with the same unique key already exists
      // dont use instanceId here, as that will always be unique
      // only prevent adding the same preset type with the same options
      // so we use getPresetUniqueKey here.
      if (userData.presets.some((a) => getPresetUniqueKey(a) === newKey)) {
        toast.error('You already have an addon with the same options added.');
        setModalOpen(false);
        return;
      }
      setUserData((prev) => ({
        ...prev,
        presets: [...prev.presets, newPreset],
      }));
      toast.info('Addon installed successfully!');
      setModalOpen(false);
    } else if (modalMode === 'edit' && editingAddonId) {
      // Edit existing preset (should not be triggered from marketplace)
      setUserData((prev) => ({
        ...prev,
        presets: prev.presets.map((a) =>
          a.instanceId === editingAddonId
            ? { ...a, options: values.options }
            : a
        ),
      }));
      toast.info('Addon updated successfully!');
      setModalOpen(false);
    }
  }

  // DND for My Addons
  function handleDragEnd(event: any) {
    const { active, over } = event;
    if (!over) return;
    if (active.id !== over.id) {
      const oldIndex = userData.presets.findIndex(
        (a) => a.instanceId === active.id
      );
      const newIndex = userData.presets.findIndex(
        (a) => a.instanceId === over.id
      );
      const newPresets = arrayMove(userData.presets, oldIndex, newIndex);
      setUserData((prev) => ({
        ...prev,
        presets: newPresets,
      }));
    }
    setIsDragging(false);
  }

  function handleDragStart(event: any) {
    setIsDragging(true);
  }

  // Service, stream type options
  const serviceOptions = Object.values(constants.SERVICE_DETAILS).map(
    (service) => ({ label: service.name, value: service.id })
  );
  const typeLabelMap: Record<string, string> = {
    p2p: 'P2P',
    http: 'HTTP',
    usenet: 'Usenet',
    debrid: 'Debrid',
    live: 'Live',
  };
  const streamTypeOptions = (constants.STREAM_TYPES || [])
    .filter(
      (type) =>
        ![
          'error',
          'statistic',
          'external',
          'youtube',
          'stremio-usenet',
          'archive',
        ].includes(type)
    )
    .map((type: string) => ({ label: typeLabelMap[type], value: type }));

  // DND-kit setup
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 150,
        tolerance: 8,
      },
    })
  );

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
      // Add listeners for when drag ends outside context
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

  // Group presets by category
  const streamPresets = filteredPresets.filter(
    (n) => n.CATEGORY === constants.PresetCategory.STREAMS || !n.CATEGORY
  );
  const subtitlePresets = filteredPresets.filter(
    (n) => n.CATEGORY === constants.PresetCategory.SUBTITLES
  );
  const metaCatalogPresets = filteredPresets.filter(
    (n) => n.CATEGORY === constants.PresetCategory.META_CATALOGS
  );
  const miscPresets = filteredPresets.filter(
    (n) => n.CATEGORY === constants.PresetCategory.MISC
  );

  const addonGridClassName =
    'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 3xl:grid-cols-5 5xl:grid-cols-6 6xl:grid-cols-7 7xl:grid-cols-8 gap-4';

  return (
    <>
      {/* <div className="flex items-center w-full">
        <div>
          <h2>Addons</h2>
          <p className="text-[--muted]">Manage your installed addons or</p>
        </div>
        <div className="flex flex-1"></div>
      </div> */}

      <div className="flex items-center justify-between gap-2">
        <StaticTabs
          className="h-10 w-fit max-w-full border rounded-full"
          triggerClass="px-4 py-1 text-md"
          items={[
            {
              name: 'Installed',
              isCurrent: page === 'installed',
              onClick: () => setPage('installed'),
              iconType: LuDownload,
            },
            {
              name: 'Marketplace',
              isCurrent: page === 'marketplace',
              onClick: () => setPage('marketplace'),
              iconType: LuGlobe,
            },
          ]}
        />

        <div className="hidden lg:block lg:ml-auto">
          <PageControls />
        </div>
      </div>

      <AnimatePresence mode="wait">
        {page === 'installed' && (
          <PageWrapper
            {...{
              initial: { opacity: 0, y: 60 },
              animate: { opacity: 1, y: 0 },
              exit: { opacity: 0, scale: 0.99 },
              transition: {
                duration: 0.35,
              },
            }}
            key="installed"
            className="pt-0 space-y-8 relative z-[4]"
          >
            <div>
              <h2>Installed Addons</h2>
              <p className="text-[--muted] text-sm">
                Manage your installed addons.
              </p>
            </div>
            <SettingsCard
              title="My Addons"
              description="Edit, remove, and reorder your installed addons. If you reorder your addons, you will have to refresh the catalogs if you have made any changes, and also reinstall the addon."
            >
              <DndContext
                modifiers={[restrictToVerticalAxis]}
                onDragEnd={handleDragEnd}
                onDragStart={handleDragStart}
                sensors={sensors}
              >
                <SortableContext
                  items={userData.presets.map((a) => a.instanceId)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-2">
                    <ul className="space-y-2">
                      {userData.presets.length === 0 ? (
                        <li>
                          <div className="flex flex-col items-center justify-center py-12">
                            <span className="text-lg text-muted-foreground font-semibold text-center">
                              Looks like you don't have any addons...
                              <br />
                              Add some from the marketplace!
                            </span>
                          </div>
                        </li>
                      ) : (
                        userData.presets.map((preset) => {
                          const presetMetadata = status?.settings?.presets.find(
                            (p: any) => p.ID === preset.type
                          );
                          return (
                            <SortableAddonItem
                              key={getPresetUniqueKey(preset)}
                              preset={preset}
                              presetMetadata={presetMetadata}
                              onEdit={() => {
                                setModalPreset(presetMetadata);
                                setModalInitialValues({
                                  options: { ...preset.options },
                                });
                                setModalMode('edit');
                                setEditingAddonId(preset.instanceId);
                                setModalOpen(true);
                              }}
                              onRemove={() => {
                                setUserData((prev) => ({
                                  ...prev,
                                  presets: prev.presets.filter(
                                    (a) => a.instanceId !== preset.instanceId
                                  ),
                                  groups: prev.groups
                                    ? {
                                        ...prev.groups,
                                        groupings: (prev.groups.groupings || []).map((g) => ({
                                          ...g,
                                          addons: g.addons.filter(
                                            (id) => id !== preset.instanceId
                                          ),
                                        })),
                                      }
                                    : prev.groups,
                                }));
                              }}
                              onToggleEnabled={(v: boolean) => {
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
                          );
                        })
                      )}
                    </ul>
                  </div>
                </SortableContext>
              </DndContext>
            </SettingsCard>

            {userData.presets.length > 0 && <CatalogSettingsCard />}

            {userData.presets.length > 0 && <MergedCatalogsCard />}

            {userData.presets.length > 0 && mode === 'pro' && (
              <AddonFetchingBehaviorCard />
            )}
          </PageWrapper>
        )}

        {page === 'marketplace' && (
          <PageWrapper
            {...{
              initial: { opacity: 0, y: 60 },
              animate: { opacity: 1, y: 0 },
              exit: { opacity: 0, scale: 0.99 },
              transition: {
                duration: 0.35,
              },
            }}
            key="marketplace"
            className="pt-0 space-y-6 relative z-[4]"
          >
            <div>
              <h2>Marketplace</h2>
              <p className="text-[--muted] text-sm">
                Browse and install addons from the marketplace.
              </p>
            </div>

            {/* Category tabs */}
            <StaticTabs
              className="h-10 w-fit max-w-full border rounded-full"
              triggerClass="px-4 py-1 text-sm"
              items={[
                {
                  name: 'All',
                  isCurrent: categoryFilter === 'all',
                  onClick: () => setCategoryFilter('all'),
                },
                {
                  name: 'Streams',
                  isCurrent:
                    categoryFilter === constants.PresetCategory.STREAMS,
                  onClick: () =>
                    setCategoryFilter(constants.PresetCategory.STREAMS),
                },
                {
                  name: 'Subtitles',
                  isCurrent:
                    categoryFilter === constants.PresetCategory.SUBTITLES,
                  onClick: () =>
                    setCategoryFilter(constants.PresetCategory.SUBTITLES),
                },
                {
                  name: 'Metadata & Catalogs',
                  isCurrent:
                    categoryFilter === constants.PresetCategory.META_CATALOGS,
                  onClick: () =>
                    setCategoryFilter(constants.PresetCategory.META_CATALOGS),
                },
                {
                  name: 'Miscellaneous',
                  isCurrent: categoryFilter === constants.PresetCategory.MISC,
                  onClick: () =>
                    setCategoryFilter(constants.PresetCategory.MISC),
                },
              ]}
            />

            {/* Filters and search row */}
            <div className="flex flex-col lg:flex-row gap-2">
              <div className="flex gap-2 flex-1 lg:flex-none">
                <Select
                  value={serviceFilter}
                  onValueChange={setServiceFilter}
                  options={[
                    { label: 'All Services', value: 'all' },
                    ...serviceOptions,
                  ]}
                  fieldClass="lg:w-[200px]"
                />
                <Select
                  value={streamTypeFilter}
                  onValueChange={setStreamTypeFilter}
                  options={[
                    { label: 'All Types', value: 'all' },
                    ...streamTypeOptions,
                  ]}
                  fieldClass="lg:w-[200px]"
                />
              </div>
              <TextInput
                value={search}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setSearch(e.target.value)
                }
                placeholder="Search addons..."
                className="flex-1"
                leftIcon={<SearchIcon className="w-4 h-4" />}
              />
            </div>

            {/* Addon cards by category */}
            {filteredPresets.length === 0 && (
              <Card className="p-8 text-center">
                <p className="text-[--muted]">
                  No addons found matching your criteria.
                </p>
              </Card>
            )}

            {!!streamPresets?.length && (
              <Card className="p-4 space-y-6">
                <h3 className="flex gap-3 items-center">
                  <RiFolderDownloadFill /> Streams
                </h3>
                <div className={addonGridClassName}>
                  {streamPresets.map((preset: any) => (
                    <AddonCard
                      key={preset.ID}
                      preset={preset}
                      onAdd={() => handleAddPreset(preset)}
                    />
                  ))}
                </div>
              </Card>
            )}

            {!!subtitlePresets?.length && (
              <Card className="p-4 space-y-6">
                <h3 className="flex gap-3 items-center">
                  <MdSubtitles /> Subtitles
                </h3>
                <div className={addonGridClassName}>
                  {subtitlePresets.map((preset: any) => (
                    <AddonCard
                      key={preset.ID}
                      preset={preset}
                      onAdd={() => handleAddPreset(preset)}
                    />
                  ))}
                </div>
              </Card>
            )}

            {!!metaCatalogPresets?.length && (
              <Card className="p-4 space-y-6">
                <h3 className="flex gap-3 items-center">
                  <MdOutlineDataset /> Metadata & Catalogs
                </h3>
                <div className={addonGridClassName}>
                  {metaCatalogPresets.map((preset: any) => (
                    <AddonCard
                      key={preset.ID}
                      preset={preset}
                      onAdd={() => handleAddPreset(preset)}
                    />
                  ))}
                </div>
              </Card>
            )}

            {!!miscPresets?.length && (
              <Card className="p-4 space-y-6">
                <h3 className="flex gap-3 items-center">
                  <LuSettings /> Miscellaneous
                </h3>
                <div className={addonGridClassName}>
                  {miscPresets.map((preset: any) => (
                    <AddonCard
                      key={preset.ID}
                      preset={preset}
                      onAdd={() => handleAddPreset(preset)}
                    />
                  ))}
                </div>
              </Card>
            )}
          </PageWrapper>
        )}
      </AnimatePresence>
      {/* Add/Edit Addon Modal (ensure both tabs can use it)*/}
      <AddonModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        mode={modalMode}
        presetMetadata={modalPreset}
        initialValues={modalInitialValues as any}
        onSubmit={handleModalSubmit}
      />
    </>
  );
}

// Helper to generate a key based on an addons id and options
function getPresetUniqueKey(preset: {
  type: string;
  instanceId: string;
  enabled: boolean;
  options: Record<string, any>;
}) {
  // dont include the unique instanceId
  return JSON.stringify({
    type: preset.type,
    enabled: preset.enabled,
    options: preset.options,
  });
}

// Sortable Addon Item for DND (handles both preset and custom addon)
function SortableAddonItem({
  preset,
  presetMetadata,
  onEdit,
  onRemove,
  onToggleEnabled,
}: {
  preset: any;
  presetMetadata: any;
  onEdit: () => void;
  onRemove: () => void;
  onToggleEnabled: (v: boolean) => void;
}) {
  const { userData, setUserData } = useUserData();
  const [isConfigurable, setIsConfigurable] = useState(false);
  const [logo, setLogo] = useState<string | undefined>(
    preset.logo || presetMetadata.LOGO
  );
  const [step, setStep] = useState(1);
  // const [configModalOpen, setConfigModalOpen] = useState(false);
  const configModalOpen = useDisclosure(false);
  const [newManifestUrl, setNewManifestUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: preset.instanceId,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const standardiseManifestUrl = (url: string) => {
    return url.replace(/^stremio:\/\//, 'https://').replace(/\/$/, '');
  };

  const getManifestUrl = (): string | undefined => {
    if (presetMetadata.ID === 'custom' || presetMetadata.ID === 'aiostreams') {
      return preset.options.manifestUrl;
    }
    const url = preset.options.url;
    if (!url) return undefined;
    try {
      const urlObj = new URL(url);
      if (urlObj.pathname.endsWith('/manifest.json')) {
        return url;
      }
    } catch {}
  };

  useEffect(() => {
    if (configModalOpen.isOpen) {
      setStep(1);
    }
  }, [configModalOpen.isOpen]);

  useEffect(() => {
    let active = true;

    const manifestUrl = getManifestUrl();

    if (manifestUrl) {
      const standardisedManifestUrl = standardiseManifestUrl(manifestUrl);
      const cached = manifestCache.get(standardisedManifestUrl);
      if (cached) {
        setIsConfigurable(cached.behaviorHints?.configurable === true);
        setLogo(cached.logo);
        return; // Don't fetch again
      }

      fetch(standardisedManifestUrl)
        .then((r) => r.json())
        .then((manifest) => {
          manifestCache.set(standardisedManifestUrl, manifest);
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
  }, [presetMetadata.ID, preset.options.manifestUrl, preset.options.url]);

  const handleManifestUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    const standardisedManifest = standardiseManifestUrl(newManifestUrl);
    if (!newManifestUrl) {
      toast.error('Please enter a new manifest URL');
      return;
    }

    const regex = /^(https?|stremio):\/\/.+\/manifest\.json$/;
    if (!regex.test(standardisedManifest)) {
      toast.error('Please enter a valid manifest URL');
      return;
    }

    // attempt to fetch the manifest
    try {
      setLoading(true);
      const response = await fetch(standardisedManifest);
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
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
        presetMetadata.ID === 'custom' || presetMetadata.ID === 'aiostreams'
          ? { ...currentPreset.options, manifestUrl: standardisedManifest }
          : { ...currentPreset.options, url: standardisedManifest };
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
    <li ref={setNodeRef} style={style}>
      <div className="px-2.5 py-2 bg-[var(--background)] rounded-[--radius-md] border flex gap-2 sm:gap-3 relative">
        <div
          className="rounded-full w-6 h-auto bg-[--muted] md:bg-[--subtle] md:hover:bg-[--subtle-highlight] cursor-move flex-shrink-0"
          {...attributes}
          {...listeners}
        />
        <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
          <div className="relative flex-shrink-0 h-8 w-8 hidden sm:block">
            {logo ? (
              <Image
                src={logo}
                alt={presetMetadata.NAME}
                fill
                className="w-full h-full object-contain rounded-md"
              />
            ) : presetMetadata.ID === 'custom' ? (
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

          <p className="text-base line-clamp-1 truncate block">
            {preset.options.name}
          </p>
        </div>

        <div className="flex items-center gap-1 sm:gap-2">
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
            onClick={onRemove}
          />
        </div>
      </div>

      <Modal
        open={configModalOpen.isOpen}
        onOpenChange={configModalOpen.toggle}
        // title={`Reconfigure ${preset.options.name}`}
        title={
          <>
            <span className="mr-1.5">Reconfigure</span>
            <span className="font-semibold truncate overflow-hidden text-ellipsis">
              {preset.options.name}
            </span>
          </>
        }
        titleClass="truncate max-w-sm" // Add padding-right to avoid close button and truncate
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
                setStep(2); // Move to the next step
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
                autoFocus // Focus the input since it's the next logical action
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
    </li>
  );
}

// AddonCard component
function AddonCard({ preset, onAdd }: { preset: any; onAdd: () => void }) {
  const [showBuiltinModal, setShowBuiltinModal] = useState(false);

  return (
    <>
      <div className="border border-[rgb(255_255_255_/_5%)] relative overflow-hidden bg-gray-900/70 rounded-xl p-3 flex flex-col h-full">
        {/* Built-in ribbon - top-right */}
        {preset.BUILTIN && (
          <div
            className="absolute -right-[30px] top-[20px] bg-[rgb(var(--color-brand-500))] text-white text-xs font-semibold py-1 w-[120px] text-center transform rotate-45 shadow-md z-[2] cursor-pointer hover:bg-[rgb(var(--color-brand-600))] transition-colors"
            onClick={() => setShowBuiltinModal(true)}
            title="Click to learn more about built-in addons"
          >
            Built-in
          </div>
        )}

        <div className="z-[1] relative flex flex-col flex-1 gap-3">
          {/* Logo and Name */}
          <div className="flex gap-3 pr-16">
            {preset.ID === 'custom' ? (
              <div className="relative rounded-md size-12 bg-gray-950 overflow-hidden flex items-center justify-center">
                <PlusIcon className="w-6 h-6 text-[--brand]" />
              </div>
            ) : preset.LOGO ? (
              <div className="relative rounded-md size-12 bg-gray-900 overflow-hidden">
                <img
                  src={preset.LOGO}
                  alt={preset.NAME}
                  className="w-full h-full object-cover"
                />
              </div>
            ) : (
              <div className="relative rounded-md size-12 bg-gray-950 overflow-hidden flex items-center justify-center">
                <p className="text-2xl font-bold">
                  {preset.NAME[0].toUpperCase()}
                </p>
              </div>
            )}

            <div>
              <p className="font-semibold line-clamp-1">{preset.NAME}</p>
              <p className="text-xs line-clamp-1 tracking-wide opacity-30">
                {preset.ID}
              </p>
            </div>
          </div>

          {/* Description */}
          {preset.DESCRIPTION && (
            <Popover
              trigger={
                <p className="text-sm text-[--muted] line-clamp-2 cursor-pointer">
                  <MarkdownLite>{preset.DESCRIPTION}</MarkdownLite>
                </p>
              }
            >
              <p className="text-sm">
                <MarkdownLite>{preset.DESCRIPTION}</MarkdownLite>
              </p>
            </Popover>
          )}

          <div className="flex flex-wrap gap-1.5">
            {preset.SUPPORTED_SERVICES?.map((sid: string) => {
              const service =
                constants.SERVICE_DETAILS[
                  sid as keyof typeof constants.SERVICE_DETAILS
                ];
              return (
                <Tooltip
                  key={sid}
                  side="top"
                  trigger={
                    <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-[--brand]/10 text-[--brand] border border-[--brand]/20">
                      {service?.shortName || sid}
                    </span>
                  }
                >
                  {service?.name || sid}
                </Tooltip>
              );
            })}
            {preset.SUPPORTED_RESOURCES?.map((res: string) => (
              <span
                key={res}
                className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20"
              >
                {res}
              </span>
            ))}
            {preset.SUPPORTED_STREAM_TYPES?.map((type: string) => (
              <span
                key={type}
                className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-green-500/10 text-green-400 border border-green-500/20"
              >
                {type}
              </span>
            ))}
          </div>

          {/* Spacer to push button to bottom */}
          <div className="flex-1"></div>

          {preset.DISABLED ? (
            <div className="mt-auto">
              <Alert
                intent="alert"
                className="w-full overflow-x-auto whitespace-nowrap"
                description={
                  <MarkdownLite>{preset.DISABLED.reason}</MarkdownLite>
                }
              />
            </div>
          ) : (
            <div className="mt-auto">
              <Button
                size="md"
                className="w-full"
                intent="primary-subtle"
                onClick={onAdd}
              >
                Configure
              </Button>
            </div>
          )}
        </div>
      </div>

      <Modal
        open={showBuiltinModal}
        onOpenChange={setShowBuiltinModal}
        title="What are Built-in Addons?"
      >
        <div className="space-y-4">
          <p className="text-sm leading-relaxed">
            Built-in addons are addons whose code lives directly inside
            AIOStreams. You still install and configure them from the
            marketplace just like any other addon (such as Comet or Torrentio),
            but they run locally on this AIOStreams instance.
          </p>
          <div className="bg-[--subtle] rounded-lg p-3 space-y-2">
            <p className="text-sm font-medium">Why does this matter?</p>
            <ul className="text-sm text-[--muted] space-y-1.5 list-disc list-inside">
              <li>Not affected by rate limits from other addon servers</li>
              <li>Faster response times since there's no network delay</li>
              <li>
                Exclusive to AIOStreams and can't be installed directly to
                Stremio
              </li>
            </ul>
          </div>
          <p className="text-xs text-[--muted] italic">
            Think of it like having the addon server built into AIOStreams
            itself!
          </p>
        </div>
      </Modal>
    </>
  );
}

function AddonModal({
  open,
  onOpenChange,
  mode,
  presetMetadata,
  initialValues = {},
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  mode: 'add' | 'edit';
  presetMetadata?: any;
  initialValues?: Record<string, any>;
  onSubmit: (values: Record<string, any>) => void;
}) {
  const { mode: configMode } = useMode();
  const [values, setValues] = useState<Record<string, any>>(initialValues);
  useEffect(() => {
    if (open) {
      setValues(initialValues);
    } else {
      // when closing, delay the reset to allow the animation to finish
      // so that the user doesn't see the values being reset
      setTimeout(() => {
        setValues(initialValues);
      }, 150);
    }
  }, [open, initialValues]);
  let dynamicOptions: Option[] = presetMetadata?.OPTIONS || [];
  if (configMode === 'noob') {
    dynamicOptions = dynamicOptions.filter((opt: any) => {
      if (opt?.showInSimpleMode === false) return false;
      return true;
    });
  }

  // Check if all required fields are filled
  const allRequiredFilled = dynamicOptions.every((opt: any) => {
    if (!opt.required) return true;
    const val = values.options?.[opt.id];
    // For booleans, false is valid; for others, check for empty string/null/undefined
    if (opt.type === 'boolean') return typeof val === 'boolean';
    return val !== undefined && val !== null && val !== '';
  });

  function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault();

    for (const opt of dynamicOptions) {
      if (opt.constraints) {
        const val = values.options?.[opt.id];
        if (typeof val === 'string') {
          if (opt.constraints.min && val.length < opt.constraints.min) {
            toast.error(
              `${opt.name} must be at least ${opt.constraints.min} characters`
            );
            return false;
          }
          if (opt.constraints.max && val.length > opt.constraints.max) {
            toast.error(
              `${opt.name} must be at most ${opt.constraints.max} characters`
            );
            return false;
          }
        } else if (typeof val === 'number') {
          if (opt.constraints.min && val < opt.constraints.min) {
            toast.error(`${opt.name} must be at least ${opt.constraints.min}`);
            return false;
          }
          if (opt.constraints.max && val > opt.constraints.max) {
            toast.error(`${opt.name} must be at most ${opt.constraints.max}`);
            return false;
          }
        } else if (opt.type === 'multi-select') {
          if (opt.constraints.max && val.length > opt.constraints.max) {
            toast.error(
              `${opt.name} must be at most ${opt.constraints.max} items`
            );
            return false;
          }
          if (opt.constraints.min && val.length < opt.constraints.min) {
            toast.error(
              `${opt.name} must be at least ${opt.constraints.min} items`
            );
            return false;
          }
        }
      }
    }
    if (allRequiredFilled) {
      onSubmit(values);
    } else {
      toast.error('Please fill in all required fields');
    }
  }

  return (
    <Modal
      open={open}
      description={<MarkdownLite>{presetMetadata?.DESCRIPTION}</MarkdownLite>}
      onOpenChange={onOpenChange}
      title={
        mode === 'add'
          ? `Install ${presetMetadata?.NAME}`
          : `Edit ${presetMetadata?.NAME}`
      }
    >
      <form className="space-y-4" onSubmit={handleFormSubmit}>
        {dynamicOptions.map((opt: any) => (
          <div key={opt.id} className="mb-2">
            <TemplateOption
              option={opt}
              value={values.options?.[opt.id]}
              onChange={(v: any) =>
                setValues((val) => ({
                  ...val,
                  options: { ...val.options, [opt.id]: v },
                }))
              }
              disabled={false}
            />
          </div>
        ))}
        <Button
          className="w-full mt-2"
          type="submit"
          disabled={!allRequiredFilled}
        >
          {mode === 'add' ? 'Install' : 'Update'}
        </Button>
      </form>
    </Modal>
  );
}

function AddonFetchingBehaviorCard() {
  const { userData, setUserData } = useUserData();
  const [mode, setMode] = useState(() => {
    if (userData.dynamicAddonFetching?.enabled) return 'dynamic';
    if (userData.groups?.enabled) return 'groups';
    return 'default';
  });

  // Helper function to get presets that are not in any group except the current one
  const getAvailablePresets = (currentGroupIndex: number) => {
    const presetsInOtherGroups = new Set(
      userData.groups?.groupings?.flatMap((group, idx) =>
        idx !== currentGroupIndex ? group.addons : []
      ) || []
    );

    return userData.presets
      .filter((preset) => {
        return !presetsInOtherGroups.has(preset.instanceId);
      })
      .map((preset) => ({
        label: preset.options.name,
        value: preset.instanceId,
        textValue: preset.options.name,
      }));
  };

  const updateGroup = (
    index: number,
    updates: Partial<{ addons: string[]; condition: string }>
  ) => {
    setUserData((prev) => {
      const currentGroups = prev.groups?.groupings || [];
      const newGroups = [...currentGroups];
      newGroups[index] = {
        ...newGroups[index],
        ...updates,
      };
      if (index === 0) {
        newGroups[index].condition = 'true';
      }
      return {
        ...prev,
        groups: {
          ...prev.groups,
          groupings: newGroups,
        },
      };
    });
  };

  const handleModeChange = (newMode: string) => {
    setMode(newMode);
    setUserData((prev) => ({
      ...prev,
      groups: {
        ...prev.groups,
        enabled: newMode === 'groups',
      },
      dynamicAddonFetching: {
        ...prev.dynamicAddonFetching,
        enabled: newMode === 'dynamic',
      },
    }));
  };

  const descriptions = {
    default:
      'Fetch from all addons simultaneously and wait for all addons to finish fetching before returning results.',
    groups:
      'Organise addons into groups with conditions. Each group can be evaluated based on results from previous groups. Read the [Wiki](https://github.com/Viren070/AIOStreams/wiki/Groups) for more information.',
    dynamic:
      'All addons start fetching at the same time. As soon as any addon returns results, the exit condition is evaluated. If the condition is met, results are returned immediately and any remaining addon results are ignored.',
  };

  const placeholderExitConditions = [
    'count(resolution(totalStreams, "2160p")) > 0 or totalTimeTaken > 5000',
    "queryType == 'anime' ? (count(resolution(totalStreams, '1080p')) > 0 or totalTimeTaken > 5000) : false",
    "'addon' in queriedAddons and (totalTimeTaken >= 6000 or count(totalStreams) >= 5)",
    "count(seeders(size(totalStreams, '5GB', '20GB'), 50)) > 0",
    "queryType == 'movie' ? count(cached(resolution(totalStreams, '2160p'))) > 0 : count(resolution(totalStreams, '1080p')) >= 2",
    "count(cached(quality(totalStreams, 'Bluray REMUX', 'Bluray', 'WEB-DL'))) > 0",
  ];

  return (
    <SettingsCard
      title="Addon Fetching Strategy"
      description="Choose how streams are fetched from your addons"
    >
      <Select
        label="Strategy"
        value={mode}
        onValueChange={handleModeChange}
        options={[
          { label: 'Default', value: 'default' },
          { label: 'Dynamic', value: 'dynamic' },
          { label: 'Groups', value: 'groups' },
        ]}
      />

      <div className="text-sm text-[--muted] mt-2 mb-4">
        {descriptions[mode as keyof typeof descriptions]}
      </div>

      {mode === 'groups' && (
        <>
          <Select
            label="Group Behaviour"
            value={userData.groups?.behaviour ?? 'parallel'}
            onValueChange={(value) => {
              setUserData((prev) => ({
                ...prev,
                groups: {
                  ...prev.groups,
                  behaviour: value as 'sequential' | 'parallel',
                },
              }));
            }}
            options={[
              { label: 'Parallel', value: 'parallel' },
              { label: 'Sequential', value: 'sequential' },
            ]}
            help={
              userData.groups?.behaviour === 'sequential'
                ? 'Sequential: Start with group 1. Only fetch from group 2 if its condition evaluates to true based on group 1\'s results (e.g., "count(totalStreams) < 4"). Continue this pattern for subsequent groups.'
                : "Parallel: Begin fetching from all groups simultaneously. When group 1's results arrive, evaluate group 2's condition. If true, wait for group 2's results; if false, return results without waiting."
            }
          />

          {(() => {
            const handleGroupsChange = (newGroups: any[]) => {
              const normalized = [...newGroups];
              if (normalized.length > 0) {
                normalized[0] = { ...normalized[0], condition: 'true' };
              }
              setUserData((prev) => ({
                ...prev,
                groups: { ...prev.groups, groupings: normalized },
              }));
            };

            return (userData.groups?.groupings || []).map((group, index) => (
              <div key={index} className="flex gap-2">
                <div className="flex-1 flex gap-2">
                  <div className="flex-1">
                    <Combobox
                      multiple
                      value={group.addons}
                      options={getAvailablePresets(index)}
                      emptyMessage="You haven't installed any addons yet or they are already in a group"
                      label="Addons"
                      placeholder="Select addons"
                      onValueChange={(value) => {
                        updateGroup(index, { addons: value });
                      }}
                    />
                  </div>
                  <div className="flex-1">
                    <TextInput
                      value={index === 0 ? 'true' : group.condition}
                      disabled={index === 0}
                      label="Condition"
                      placeholder="Enter condition"
                      onValueChange={(value) => {
                        updateGroup(index, { condition: value });
                      }}
                    />
                  </div>
                </div>
                <IconButton
                  size="sm"
                  rounded
                  icon={<FaArrowUp />}
                  intent="primary-subtle"
                  disabled={index === 0}
                  onClick={() => {
                    handleGroupsChange(
                      arrayMove(userData.groups?.groupings || [], index, index - 1)
                    );
                  }}
                />
                <IconButton
                  size="sm"
                  rounded
                  icon={<FaArrowDown />}
                  intent="primary-subtle"
                  disabled={
                    index === (userData.groups?.groupings || []).length - 1
                  }
                  onClick={() => {
                    handleGroupsChange(
                      arrayMove(userData.groups?.groupings || [], index, index + 1)
                    );
                  }}
                />
                <IconButton
                  size="sm"
                  rounded
                  icon={<FaRegTrashAlt />}
                  intent="alert-subtle"
                  onClick={() => {
                    const newGroups = [...(userData.groups?.groupings || [])];
                    newGroups.splice(index, 1);
                    handleGroupsChange(newGroups);
                  }}
                />
              </div>
            ));
          })()}

          <div className="mt-2 flex gap-2 items-center">
            <IconButton
              rounded
              size="sm"
              intent="primary-subtle"
              icon={<FaPlus />}
              onClick={() => {
                setUserData((prev) => {
                  const currentGroups = prev.groups?.groupings || [];
                  const newGroup = {
                    addons: [],
                    condition: currentGroups.length === 0 ? 'true' : '',
                  };
                  return {
                    ...prev,
                    groups: {
                      ...prev.groups,
                      groupings: [...currentGroups, newGroup],
                    },
                  };
                });
              }}
            />
          </div>
        </>
      )}

      {mode === 'dynamic' && (
        <TextInput
          label="Exit Condition"
          placeholder={
            placeholderExitConditions[
              Math.floor(Math.random() * placeholderExitConditions.length)
            ]
          }
          value={userData.dynamicAddonFetching?.condition ?? ''}
          onValueChange={(value) => {
            setUserData((prev) => ({
              ...prev,
              dynamicAddonFetching: {
                ...prev.dynamicAddonFetching,
                condition: value,
              },
            }));
          }}
          help={
            <p>
              Write the condition using{' '}
              <a
                href="https://github.com/Viren070/AIOStreams/wiki/Stream-Expression-Language"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[--brand] hover:underline"
              >
                Stream Expression Language (SEL)
              </a>
              . The following variables are available:
              <ul className="list-disc list-inside space-y-1 ml-2 mt-2">
                <li>
                  <code>totalStreams</code>: The total number of streams
                </li>
                <li>
                  <code>totalTimeTaken</code>: The total time taken to fetch the
                  streams
                </li>
                <li>
                  <code>queryType</code>: The type of query e.g. 'movie',
                  'series', or 'anime'
                </li>
                <li>
                  <code>queriedAddons</code>: The addons that have been queried.
                  Tip: use the <code>in</code> operator to check if a specific
                  addon has been queried.
                </li>
                <li>
                  <code>allAddons</code>: All addons that were intended to be
                  used for that query.
                </li>
              </ul>
            </p>
          }
        />
      )}
    </SettingsCard>
  );
}

function CatalogSettingsCard() {
  const { userData, setUserData } = useUserData();
  const [loading, setLoading] = useState(false);

  const fetchCatalogs = async (hideToast = false) => {
    setLoading(true);
    try {
      const response = await UserConfigAPI.getCatalogs(userData);
      if (response.success && response.data) {
        setUserData((prev) => {
          const existingMods = prev.catalogModifications || [];
          const existingIds = new Set(
            existingMods.map((mod) => `${mod.id}-${mod.type}`)
          );

          // first we need to handle existing modifications, to ensure that they keep their order
          const modifications = existingMods.map((eMod) => {
            // Skip merged catalogs - they don't come from the API
            if (eMod.id.startsWith('aiostreams.merged.')) {
              return eMod;
            }
            const nMod = response.data!.find(
              (c) => c.id === eMod.id && c.type === eMod.type
            );
            if (nMod) {
              return {
                // keep all the existing attributes, except addonName, type, hideable
                ...eMod,
                addonName: nMod.addonName,
                type: nMod.type,
                hideable: nMod.hideable,
                searchable: nMod.searchable,
              };
            }
            return eMod;
          });

          // Add new catalogs at the bottom
          response.data!.forEach((catalog) => {
            if (!existingIds.has(`${catalog.id}-${catalog.type}`)) {
              modifications.push({
                id: catalog.id,
                name: catalog.name,
                type: catalog.type,
                enabled: true,
                shuffle: false,
                usePosterService: !!(
                  userData.rpdbApiKey || userData.topPosterApiKey
                ),
                hideable: catalog.hideable,
                searchable: catalog.searchable,
                addonName: catalog.addonName,
              });
            }
          });

          // Filter out modifications for catalogs that no longer exist
          // BUT keep merged catalogs (they're managed separately)
          const newCatalogIds = new Set(
            response.data!.map((c) => `${c.id}-${c.type}`)
          );
          const filteredMods = modifications.filter((mod) =>
            newCatalogIds.has(`${mod.id}-${mod.type}`)
          );

          return {
            ...prev,
            catalogModifications: filteredMods,
          };
        });
        if (!hideToast) {
          toast.success('Catalogs fetched successfully');
        }
      } else {
        toast.error(response.error?.message || 'Failed to fetch catalogs');
      }
    } catch (error) {
      toast.error('Failed to fetch catalogs');
    } finally {
      setLoading(false);
    }
  };

  // Auto-fetch catalogs when component mounts
  useEffect(() => {
    fetchCatalogs(true);
  }, []); // Empty dependency array means this runs once when component mounts

  // Track merged catalogs count to trigger refresh when a merged catalog is added/removed
  const mergedCatalogsCountRef = useRef(userData.mergedCatalogs?.length ?? 0);
  useEffect(() => {
    const currentCount = userData.mergedCatalogs?.length ?? 0;
    if (currentCount !== mergedCatalogsCountRef.current) {
      mergedCatalogsCountRef.current = currentCount;
      // Trigger refresh when merged catalog count changes (added or deleted)
      fetchCatalogs(true);
    }
  }, [userData.mergedCatalogs?.length, fetchCatalogs]);

  const capitalise = (str: string | undefined) => {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
  };

  // Build set of source catalog IDs that are part of enabled merged catalogs
  const sourceCatalogsInMergedCatalogs = useMemo(() => {
    const set = new Set<string>();
    const enabledMerged = (userData.mergedCatalogs || []).filter(
      (mc) => mc.enabled !== false
    );
    for (const mc of enabledMerged) {
      for (const encodedId of mc.catalogIds) {
        const params = new URLSearchParams(encodedId);
        const id = params.get('id');
        const type = params.get('type');
        if (id && type) {
          set.add(`${id}-${type}`);
        }
      }
    }
    return set;
  }, [userData.mergedCatalogs]);

  // DND handlers
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
          (c) => `${c.id}-${c.type}` === active.id
        );
        const newIndex = prev.catalogModifications?.findIndex(
          (c) => `${c.id}-${c.type}` === over.id
        );
        if (
          oldIndex === undefined ||
          newIndex === undefined ||
          !prev.catalogModifications
        )
          return prev;
        return {
          ...prev,
          catalogModifications: arrayMove(
            prev.catalogModifications,
            oldIndex,
            newIndex
          ),
        };
      });
    }
    setIsDragging(false);
  };

  const handleDragStart = () => {
    setIsDragging(true);
  };

  return (
    <SettingsCard
      title="Catalogs"
      description="Rename, Reorder, and toggle your catalogs, and apply modifications like RPDB posters and shuffling. If you reorder the addons, you need to reinstall the addon"
      action={
        <IconButton
          size="sm"
          intent="warning-subtle"
          icon={<MdRefresh />}
          rounded
          onClick={() => {
            fetchCatalogs();
          }}
          loading={loading}
        />
      }
    >
      {!userData.catalogModifications?.length && (
        <p className="text-[--muted] text-base text-center my-8">
          Your addons don't have any catalogs... or you haven't fetched them yet
          :/
        </p>
      )}
      {userData.catalogModifications &&
        userData.catalogModifications.length > 0 && (
          <DndContext
            modifiers={[restrictToVerticalAxis]}
            onDragEnd={handleDragEnd}
            onDragStart={handleDragStart}
            sensors={sensors}
          >
            <SortableContext
              items={(userData.catalogModifications || []).map(
                (c) => `${c.id}-${c.type}`
              )}
              strategy={verticalListSortingStrategy}
            >
              <ul className="space-y-2">
                {(userData.catalogModifications || [])
                  .filter(
                    (catalog) =>
                      !sourceCatalogsInMergedCatalogs.has(
                        `${catalog.id}-${catalog.type}`
                      )
                  )
                  .map((catalog: CatalogModification) => (
                    <SortableCatalogItem
                      key={`${catalog.id}-${catalog.type}`}
                      catalog={catalog}
                      onToggleEnabled={(enabled) => {
                        setUserData((prev) => {
                          const newState: Partial<typeof prev> = {
                            catalogModifications:
                              prev.catalogModifications?.map((c) =>
                                c.id === catalog.id && c.type === catalog.type
                                  ? { ...c, enabled }
                                  : c
                              ),
                          };
                          // If this is a merged catalog, also update mergedCatalogs state
                          if (catalog.id.startsWith('aiostreams.merged.')) {
                            newState.mergedCatalogs = prev.mergedCatalogs?.map(
                              (mc) =>
                                mc.id === catalog.id ? { ...mc, enabled } : mc
                            );
                          }
                          return { ...prev, ...newState };
                        });
                      }}
                      capitalise={capitalise}
                    />
                  ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}
    </SettingsCard>
  );
}

function MergedCatalogsCard() {
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
    }));
    toast.success('Merged catalog deleted');
  };

  return (
    <SettingsCard
      title="Merged Catalogs"
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

// Add the SortableCatalogItem component
function SortableCatalogItem({
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
                      help="Replace movie/show posters with posters from poster services (RPDB or Top Poster) when supported"
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
