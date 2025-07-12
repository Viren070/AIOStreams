'use client';
import React, { useState, useMemo, useEffect } from 'react';
import { PageWrapper } from '../shared/page-wrapper';
import { useStatus } from '@/context/status';
import { useUserData } from '@/context/userData';
import { SettingsCard } from '../shared/settings-card';
import { Button, IconButton } from '../ui/button';
import { Modal } from '../ui/modal';
import { Switch } from '../ui/switch';
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
import { FaPlus, FaRegTrashAlt } from 'react-icons/fa';
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
import { FaArrowRightLong, FaRankingStar, FaShuffle } from 'react-icons/fa6';
import { PiStarFill, PiStarBold } from 'react-icons/pi';
import { IoExtensionPuzzle } from 'react-icons/io5';
import { NumberInput } from '../ui/number-input';
import { useDisclosure } from '@/hooks/disclosure';

interface CatalogModification {
  id: string;
  type: string;
  name?: string;
  overrideType?: string;
  enabled?: boolean;
  shuffle?: boolean;
  persistShuffleFor?: number;
  rpdb?: boolean;
  onlyOnDiscover?: boolean;
  hideable?: boolean;
  searchable?: boolean;
  addonName?: string;
  disableSearch?: boolean;
}

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
  const { userData, setUserData } = useUserData();
  const [page, setPage] = useState<'installed' | 'marketplace'>('installed');
  const [search, setSearch] = useState('');
  // Filter states
  const [serviceFilters, setServiceFilters] = useState<string[]>([]);
  const [streamTypeFilters, setStreamTypeFilters] = useState<
    constants.StreamType[]
  >([]);
  const [resourceFilters, setResourceFilters] = useState<string[]>([]);
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
    return status.settings.presets.filter((preset) => {
      if (preset.ID === 'custom') return true;
      const matchesService =
        serviceFilters.length === 0 ||
        (preset.SUPPORTED_SERVICES &&
          serviceFilters.every((s) => preset.SUPPORTED_SERVICES.includes(s)));
      const matchesStreamType =
        streamTypeFilters.length === 0 ||
        (preset.SUPPORTED_STREAM_TYPES &&
          streamTypeFilters.every((t) =>
            preset.SUPPORTED_STREAM_TYPES.includes(t)
          ));
      const matchesResource =
        resourceFilters.length === 0 ||
        (preset.SUPPORTED_RESOURCES &&
          resourceFilters.every((r) =>
            preset.SUPPORTED_RESOURCES.includes(r as Resource)
          ));
      const matchesSearch =
        !search ||
        preset.NAME.toLowerCase().includes(search.toLowerCase()) ||
        preset.DESCRIPTION.toLowerCase().includes(search.toLowerCase());
      return (
        matchesService && matchesStreamType && matchesResource && matchesSearch
      );
    });
  }, [status, search, serviceFilters, streamTypeFilters, resourceFilters]);

  // My Addons (user's enabled/added presets)

  // AddonModal handlers
  function handleAddPreset(preset: any) {
    setModalPreset(preset);
    setModalInitialValues({
      options: Object.fromEntries(
        (preset.OPTIONS || []).map((opt: any) => [
          opt.id,
          opt.default ?? undefined,
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

  // Service, stream type, and resource options
  const serviceOptions = Object.values(constants.SERVICE_DETAILS).map(
    (service) => ({ label: service.name, value: service.id })
  );
  const streamTypeOptions = (constants.STREAM_TYPES || [])
    .filter((type) => type !== 'error')
    .map((type: string) => ({ label: type, value: type }));
  const resourceOptions = (constants.RESOURCES || []).map((res: string) => ({
    label: res,
    value: res,
  }));
  const activeFilterCount =
    serviceFilters.length + streamTypeFilters.length + resourceFilters.length;

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
  return (
    <>
      {/* <div className="flex items-center w-full">
        <div>
          <h2>Addons</h2>
          <p className="text-[--muted]">Manage your installed addons or</p>
        </div>
        <div className="flex flex-1"></div>
      </div> */}

      <div className="flex items-center justify-between">
        <StaticTabs
          className="h-10 w-fit border rounded-full"
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

            {userData.presets.length > 0 && <AddonGroupCard />}
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
            className="pt-0 space-y-8 relative z-[4]"
          >
            <div>
              <h2>Marketplace</h2>
              <p className="text-[--muted] text-sm">
                Browse and install addons from the marketplace.
              </p>
            </div>
            <div className="bg-[--card] border border-[--border] rounded-xl p-4 mb-6 shadow-sm">
              <div className="flex justify-center mb-4">
                <div className="w-full sm:w-[500px] flex gap-2">
                  <TextInput
                    value={search}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setSearch(e.target.value)
                    }
                    placeholder="Search addons..."
                    className="flex-1"
                    leftIcon={<SearchIcon className="w-4 h-4" />}
                  />
                  <AddonFilterPopover
                    serviceOptions={serviceOptions}
                    streamTypeOptions={streamTypeOptions}
                    resourceOptions={resourceOptions}
                    serviceFilters={serviceFilters}
                    setServiceFilters={setServiceFilters}
                    streamTypeFilters={streamTypeFilters}
                    setStreamTypeFilters={setStreamTypeFilters}
                    resourceFilters={resourceFilters}
                    setResourceFilters={setResourceFilters}
                  >
                    <IconButton
                      icon={<FilterIcon className="w-5 h-5" />}
                      intent={
                        activeFilterCount > 0 ? 'primary' : 'primary-outline'
                      }
                      aria-label="Filters"
                    />
                  </AddonFilterPopover>
                </div>
              </div>
              {/* Scrollable Addon Cards Grid */}
              <div className="h-[calc(100vh-300px)] overflow-y-auto pr-1">
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {filteredPresets.map((preset: any) => {
                    // Always allow adding, never show edit
                    return (
                      <AddonCard
                        key={preset.ID}
                        preset={preset}
                        isAdded={false}
                        onAdd={() => handleAddPreset(preset)}
                      />
                    );
                  })}
                </div>
              </div>
            </div>
          </PageWrapper>
        )}
        {/* Add/Edit Addon Modal (ensure both tabs can use it)*/}
        <AddonModal
          open={modalOpen}
          onOpenChange={setModalOpen}
          mode={modalMode}
          presetMetadata={modalPreset}
          initialValues={modalInitialValues as any}
          onSubmit={handleModalSubmit}
        />
      </AnimatePresence>
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

  useEffect(() => {
    if (configModalOpen.isOpen) {
      setStep(1);
    }
  }, [configModalOpen.isOpen]);

  useEffect(() => {
    let active = true;

    if (presetMetadata.ID === 'custom' && preset.options.manifestUrl) {
      const manifestUrl = preset.options.manifestUrl.replace(
        /^stremio:\/\//,
        'https://'
      );
      const cached = manifestCache.get(manifestUrl);
      if (cached) {
        setIsConfigurable(cached.behaviorHints?.configurable === true);
        return; // Don't fetch again
      }

      fetch(manifestUrl)
        .then((r) => r.json())
        .then((manifest) => {
          manifestCache.set(manifestUrl, manifest);
          if (active) {
            setIsConfigurable(manifest?.behaviorHints?.configurable === true);
          }
        })
        .catch(() => {
          if (active) setIsConfigurable(false);
        });
    }

    return () => {
      active = false;
    };
  }, [presetMetadata.ID, preset.options.manifestUrl]);

  const handleManifestUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newManifestUrl) {
      toast.error('Please enter a new manifest URL');
      return;
    }

    const regex = /^(https?|stremio):\/\/.+\/manifest\.json$/;
    if (!regex.test(newManifestUrl)) {
      toast.error('Please enter a valid manifest URL');
      return;
    }

    // attempt to fetch the manifest
    try {
      setLoading(true);
      const response = await fetch(newManifestUrl);
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
      await response.json();
    } catch (error: any) {
      toast.error(`Failed to fetch or parse manifest: ${error.message}`);
      return;
    }

    setUserData((prev) => ({
      ...prev,
      presets: prev.presets.map((p) =>
        p.instanceId === preset.instanceId
          ? {
              ...p,
              options: {
                ...p.options,
                manifestUrl: newManifestUrl,
              },
            }
          : p
      ),
    }));

    setNewManifestUrl('');
    configModalOpen.close();
    toast.success('Manifest URL updated successfully');
    setLoading(false);
  };

  const getConfigureUrl = () => {
    if (!preset.options.manifestUrl) return '';
    return preset.options.manifestUrl
      .replace(/^stremio:\/\//, 'https://')
      .replace(/\/manifest\.json$/, '/configure');
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
            {presetMetadata.ID === 'custom' ? (
              <PlusIcon className="w-full h-full object-contain" />
            ) : (
              <Image
                src={presetMetadata.LOGO}
                alt={presetMetadata.NAME}
                fill
                className="w-full h-full object-contain rounded-md"
              />
            )}
          </div>

          <p className="text-base line-clamp-1 truncate block">
            {preset.options.name}
          </p>
        </div>

        <div className="flex items-center gap-1 sm:gap-2">
          <Switch
            value={!!preset.enabled}
            onValueChange={onToggleEnabled}
            size="sm"
          />
          {isConfigurable && presetMetadata.ID === 'custom' && (
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
function AddonCard({
  preset,
  isAdded,
  onAdd,
}: {
  preset: any;
  isAdded: boolean;
  onAdd: () => void;
}) {
  return (
    <div className="flex flex-col min-h-72 h-auto bg-[--background] border border-[--border] rounded-lg shadow-sm p-4 relative">
      {/* Top: Logo + Name/Description */}
      <div className="flex gap-4 items-start">
        {preset.ID === 'custom' ? (
          <div className="w-28 h-28 min-w-[7rem] min-h-[7rem] flex items-center justify-center rounded-lg bg-gray-900 text-[--brand] text-4xl">
            <PlusIcon className="w-12 h-12" />
          </div>
        ) : preset.LOGO ? (
          <img
            src={preset.LOGO}
            alt={preset.NAME}
            className="w-28 h-28 min-w-[7rem] min-h-[7rem] object-contain rounded-lg bg-gray-800"
          />
        ) : (
          <div className="w-28 h-28 min-w-[7rem] min-h-[7rem] flex items-center justify-center rounded-lg bg-gray-900 text-[--brand] text-4xl">
            <IoExtensionPuzzle className="w-15 h-15" />
          </div>
        )}
        <div className="flex flex-col min-w-0 flex-1">
          <div className="font-bold text-lg mb-1 truncate">{preset.NAME}</div>
          <div className="text-sm text-muted-foreground mb-2 line-clamp-3 whitespace-pre-line">
            <MarkdownLite>{preset.DESCRIPTION}</MarkdownLite>
          </div>
        </div>
      </div>
      {/* Tags Section */}
      <div className="flex flex-col gap-1 mt-2">
        <div className="flex flex-wrap gap-1 items-center min-h-[1.5rem]">
          {preset.SUPPORTED_SERVICES?.length > 0 && (
            <span className="font-semibold text-xs text-[--muted] mr-1">
              Services:
            </span>
          )}
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
                  <span className="bg-gray-800 text-xs px-2 py-0.5 rounded text-[--brand] font-mono">
                    {service?.shortName || sid}
                  </span>
                }
              >
                <span className="bg-gray-800 text-xs px-2 py-0.5 rounded text-[--brand] font-mono">
                  {service?.name || sid}
                </span>
              </Tooltip>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-1 items-center min-h-[1.5rem]">
          {preset.SUPPORTED_RESOURCES?.length > 0 && (
            <span className="font-semibold text-xs text-[--muted] mr-1">
              Resources:
            </span>
          )}
          {preset.SUPPORTED_RESOURCES?.map((res: string) => (
            <span
              key={res}
              className="bg-gray-800 text-xs px-2 py-0.5 rounded text-blue-400 font-mono"
            >
              {res}
            </span>
          ))}
        </div>
        <div className="flex flex-wrap gap-1 items-center min-h-[1.5rem]">
          {preset.SUPPORTED_STREAM_TYPES?.length > 0 && (
            <span className="font-semibold text-xs text-[--muted] mr-1">
              Stream Types:
            </span>
          )}
          {preset.SUPPORTED_STREAM_TYPES?.map((type: string) => (
            <span
              key={type}
              className="bg-gray-800 text-xs px-2 py-0.5 rounded text-green-400 font-mono"
            >
              {type}
            </span>
          ))}
        </div>
      </div>
      {preset.DISABLED ? (
        <div className="mt-auto pt-3 flex items-end">
          <Alert
            intent="alert"
            className="w-full overflow-x-auto whitespace-nowrap"
            description={<MarkdownLite>{preset.DISABLED.reason}</MarkdownLite>}
          />
        </div>
      ) : (
        <div className="mt-auto pt-3 flex items-end">
          <Button size="md" className="w-full" onClick={onAdd}>
            Configure
          </Button>
        </div>
      )}
    </div>
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
  const dynamicOptions: Option[] = presetMetadata?.OPTIONS || [];

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

function AddonFilterPopover({
  serviceOptions,
  streamTypeOptions,
  resourceOptions,
  serviceFilters,
  setServiceFilters,
  streamTypeFilters,
  setStreamTypeFilters,
  resourceFilters,
  setResourceFilters,
  children,
}: any) {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger={children}
      modal={false}
      className="p-4 max-w-full w-full"
    >
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <div className="flex flex-col max-h-60 overflow-y-auto">
            <div className="mb-2 font-semibold text-sm text-muted-foreground">
              Services
            </div>
            {serviceOptions.map((opt: any) => (
              <div
                key={opt.value}
                className="flex items-center gap-2 mb-2 last:mb-0"
              >
                <Switch
                  value={serviceFilters.includes(opt.value)}
                  onValueChange={(checked: boolean) => {
                    setServiceFilters((prev: string[]) =>
                      checked
                        ? [...prev, opt.value]
                        : prev.filter((v) => v !== opt.value)
                    );
                  }}
                  size="sm"
                />
                <span className="text-xs">{opt.label}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-col max-h-60 overflow-y-auto">
            <div className="mb-2 font-semibold text-sm text-muted-foreground">
              Stream Types
            </div>
            {streamTypeOptions.map((opt: any) => (
              <div
                key={opt.value}
                className="flex items-center gap-2 mb-2 last:mb-0"
              >
                <Switch
                  value={streamTypeFilters.includes(opt.value)}
                  onValueChange={(checked: boolean) => {
                    setStreamTypeFilters((prev: string[]) =>
                      checked
                        ? [...prev, opt.value]
                        : prev.filter((v) => v !== opt.value)
                    );
                  }}
                  size="sm"
                />
                <span className="text-xs">{opt.label}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-col max-h-60 overflow-y-auto">
            <div className="mb-2 font-semibold text-sm text-muted-foreground">
              Resources
            </div>
            {resourceOptions.map((opt: any) => (
              <div
                key={opt.value}
                className="flex items-center gap-2 mb-2 last:mb-0"
              >
                <Switch
                  value={resourceFilters.includes(opt.value)}
                  onValueChange={(checked: boolean) => {
                    setResourceFilters((prev: string[]) =>
                      checked
                        ? [...prev, opt.value]
                        : prev.filter((v) => v !== opt.value)
                    );
                  }}
                  size="sm"
                />
                <span className="text-xs">{opt.label}</span>
              </div>
            ))}
          </div>
        </div>
        <Button className="w-full mt-2" onClick={() => setOpen(false)}>
          Done
        </Button>
      </div>
    </Popover>
  );
}

function AddonGroupCard() {
  const { userData, setUserData } = useUserData();

  // Helper function to get presets that are not in any group except the current one
  const getAvailablePresets = (currentGroupIndex: number) => {
    const presetsInOtherGroups = new Set(
      userData.groups?.flatMap((group, idx) =>
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
      // Initialize groups array if it doesn't exist
      const currentGroups = prev.groups || [];

      // Create a new array with all existing groups
      const newGroups = [...currentGroups];

      // Update the specific group with new values, preserving other fields
      newGroups[index] = {
        ...newGroups[index],
        ...updates,
      };

      if (index === 0) {
        // set condition for first group to true
        newGroups[index].condition = 'true';
      }

      return {
        ...prev,
        groups: newGroups,
      };
    });
  };

  return (
    <SettingsCard
      title="Groups"
      //       description="Optionally assign your addons to groups. Streams are only fetched from your first group initially,
      // and only if a certain condition is met, will streams be fetched from the next group, and so on. Leaving this blank will mean streams are
      // fetched from all addons. For a guide and a reference to the group system,"
    >
      <div className="text-sm text-[--muted] mb-2">
        Optionally assign your addons to groups. Streams are only fetched from
        your first group initially, and only if a certain condition is met, will
        streams be fetched from the next group, and so on. Leaving this blank
        will mean streams are fetched from all addons. Check the{' '}
        <a
          href="https://github.com/Viren070/AIOStreams/wiki/Groups"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[--brand] hover:text-[--brand]/80 hover:underline"
        >
          wiki
        </a>{' '}
        for a detailed guide to using groups.
      </div>
      {(userData.groups || []).map((group, index) => (
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
            icon={<FaRegTrashAlt />}
            intent="alert-subtle"
            onClick={() => {
              setUserData((prev) => {
                const newGroups = [...(prev.groups || [])];
                newGroups.splice(index, 1);
                return {
                  ...prev,
                  groups: newGroups,
                };
              });
            }}
          />
        </div>
      ))}
      <div className="mt-2 flex gap-2 items-center">
        <IconButton
          rounded
          size="sm"
          intent="primary-subtle"
          icon={<FaPlus />}
          onClick={() => {
            setUserData((prev) => {
              const currentGroups = prev.groups || [];
              return {
                ...prev,
                groups: [...currentGroups, { addons: [], condition: '' }],
              };
            });
          }}
        />
      </div>
    </SettingsCard>
  );
}

function CatalogSettingsCard() {
  const { userData, setUserData } = useUserData();
  const [loading, setLoading] = useState(false);

  const fetchCatalogs = async () => {
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
                rpdb: userData.rpdbApiKey ? true : false,
                hideable: catalog.hideable,
                searchable: catalog.searchable,
                addonName: catalog.addonName,
              });
            }
          });

          // Filter out modifications for catalogs that no longer exist
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
        toast.success('Catalogs fetched successfully');
      } else {
        toast.error(response.error?.message || 'Failed to fetch catalogs');
      }
    } catch (error) {
      toast.error('Failed to fetch catalogs');
    } finally {
      setLoading(false);
    }
  };

  const capitalise = (str: string | undefined) => {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
  };

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

  const confirmRefreshCatalogs = useConfirmationDialog({
    title: 'Refresh Catalogs',
    description:
      'Are you sure you want to refresh the catalogs? This will remove any catalogs that are no longer available',
    onConfirm: () => {
      fetchCatalogs();
    },
  });

  return (
    <div className="rounded-[--radius] border bg-[--paper] shadow-sm p-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold text-xl text-[--muted] transition-colors hover:text-[--brand]">
            Catalogs
          </h3>
          <p className="text-[--muted] text-sm">
            Rename, Reorder, and toggle your catalogs, and apply modifications
            like RPDB posters and shuffling. If you reorder the addons, you need
            to reinstall the addon
          </p>
        </div>
        <IconButton
          size="sm"
          intent="warning-subtle"
          icon={<MdRefresh />}
          rounded
          onClick={() => {
            if (userData.catalogModifications?.length) {
              confirmRefreshCatalogs.open();
            } else {
              fetchCatalogs();
            }
          }}
          loading={loading}
        />
      </div>

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
                {(userData.catalogModifications || []).map(
                  (catalog: CatalogModification) => (
                    <SortableCatalogItem
                      key={`${catalog.id}-${catalog.type}`}
                      catalog={catalog}
                      onToggleEnabled={(enabled) => {
                        setUserData((prev) => ({
                          ...prev,
                          catalogModifications: prev.catalogModifications?.map(
                            (c) =>
                              c.id === catalog.id && c.type === catalog.type
                                ? { ...c, enabled }
                                : c
                          ),
                        }));
                      }}
                      capitalise={capitalise}
                    />
                  )
                )}
              </ul>
            </SortableContext>
          </DndContext>
        )}

      <ConfirmationDialog {...confirmRefreshCatalogs} />
    </div>
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
          className="absolute top-2 bottom-2 left-2 w-5 bg-[var(--muted)] md:bg-[var(--subtle)] md:hover:bg-[var(--subtle-highlight)] cursor-move flex-shrink-0 rounded-full"
          {...attributes}
          {...listeners}
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
              <IconButton
                className="rounded-full h-5 w-5 md:h-6 md:w-6 flex-shrink-0"
                icon={<BiEdit />}
                intent="primary-subtle"
                onClick={() => setModalOpen(true)}
              />
            </div>
            <p className="text-xs md:text-sm text-[var(--muted-foreground)] mb-2 md:mb-0">
              {catalog.addonName}
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

              {/* Enable/disable toggle - aligned right */}
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
          </div>

          {/* Settings section */}
          <Accordion type="single" collapsible>
            <AccordionItem value="settings">
              <AccordionTrigger>
                <div className="flex items-center justify-between w-full">
                  <h4 className="text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wide">
                    Settings
                  </h4>

                  {/* Active modifier icons */}
                  <div className="flex items-center gap-2 mr-2">
                    <Tooltip
                      trigger={
                        <IconButton
                          className={dynamicIconSize}
                          icon={
                            catalog.shuffle ? (
                              <FaShuffle />
                            ) : (
                              <FaArrowRightLong />
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
                                    ? { ...c, shuffle: !c.shuffle }
                                    : c
                                ),
                            }));
                          }}
                        />
                      }
                    >
                      Shuffle
                    </Tooltip>
                    <Tooltip
                      trigger={
                        <IconButton
                          className={dynamicIconSize}
                          icon={catalog.rpdb ? <PiStarFill /> : <PiStarBold />}
                          intent="primary-subtle"
                          rounded
                          onClick={(e) => {
                            e.stopPropagation();
                            setUserData((prev) => ({
                              ...prev,
                              catalogModifications:
                                prev.catalogModifications?.map((c) =>
                                  c.id === catalog.id && c.type === catalog.type
                                    ? { ...c, rpdb: !c.rpdb }
                                    : c
                                ),
                            }));
                          }}
                        />
                      }
                    >
                      RPDB
                    </Tooltip>

                    {catalog.hideable && (
                      <Tooltip
                        trigger={
                          <IconButton
                            className={dynamicIconSize}
                            icon={
                              catalog.onlyOnDiscover ? (
                                <TbSmartHomeOff />
                              ) : (
                                <TbSmartHome />
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
                            className={dynamicIconSize}
                            icon={
                              catalog.disableSearch ? (
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
                                  prev.catalogModifications?.map((c) =>
                                    c.id === catalog.id &&
                                    c.type === catalog.type
                                      ? {
                                          ...c,
                                          disableSearch: !c.disableSearch,
                                        }
                                      : c
                                  ),
                              }));
                            }}
                          />
                        }
                      >
                        Searchable
                      </Tooltip>
                    )}
                  </div>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-4">
                  {/* Large screens: horizontal layout, Medium and below: vertical layout */}
                  <div className="flex flex-col gap-4">
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
                                ? { ...c, shuffle }
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
                      label="RPDB"
                      help="Replace movie/show posters with RPDB posters when supported"
                      side="right"
                      value={catalog.rpdb ?? false}
                      onValueChange={(rpdb) => {
                        setUserData((prev) => ({
                          ...prev,
                          catalogModifications: prev.catalogModifications?.map(
                            (c) =>
                              c.id === catalog.id && c.type === catalog.type
                                ? { ...c, rpdb }
                                : c
                          ),
                        }));
                      }}
                    />

                    {catalog.hideable && (
                      <Switch
                        label="Discover Only"
                        help="Hide this catalog from the home page and only show it on the Discover page"
                        moreHelp="This can potentially break the catalog!"
                        side="right"
                        value={catalog.onlyOnDiscover ?? false}
                        onValueChange={(onlyOnDiscover) => {
                          setUserData((prev) => ({
                            ...prev,
                            catalogModifications:
                              prev.catalogModifications?.map((c) =>
                                c.id === catalog.id && c.type === catalog.type
                                  ? { ...c, onlyOnDiscover }
                                  : c
                              ),
                          }));
                        }}
                      />
                    )}

                    {catalog.searchable && (
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
                                  ? { ...c, disableSearch }
                                  : c
                              ),
                          }));
                        }}
                      />
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
