'use client';
import React, {
  useState,
  useMemo,
  useEffect,
  useRef,
  useCallback,
} from 'react';
import { CatalogModification } from '@aiostreams/core';
import { PageWrapper } from '../../shared/page-wrapper';
import { useStatus } from '@/context/status';
import { useUserData, useParentInheritance } from '@/context/userData';
import { InheritedBadge } from '../../shared/inherited-badge';
import { Button } from '../../ui/button';
import { Card } from '../../ui/card';
import { TextInput } from '../../ui/text-input';
import { SearchIcon } from 'lucide-react';
import { StaticTabs } from '../../ui/tabs';
import { LuDownload, LuGlobe, LuSettings } from 'react-icons/lu';
import { AnimatePresence } from 'framer-motion';
import { PageControls } from '../../shared/page-controls';
import { Select } from '../../ui/select';
import { MenuTabs } from '../../shared/menu-tabs';
import { useMode } from '@/context/mode';
import { useSubTab } from '@/context/sub-tab';
import { IoExtensionPuzzle } from 'react-icons/io5';
import { MdOutlineDataset, MdSubtitles } from 'react-icons/md';
import { RiFolderDownloadFill } from 'react-icons/ri';
import { APIError, fetchCatalogs } from '@/lib/api';
import { toast } from 'sonner';
import * as constants from '../../../../../core/src/utils/constants';

import { AddonCard } from './_components/addon-card';
import { AddonModal } from './_components/addon-modal';
import { AddonFetchingBehaviorCard } from './_components/addon-fetching-behavior';
import { CatalogSettingsCard } from './_components/catalog-settings';
import { MergedCatalogsCard } from './_components/merged-catalogs';
import { MyAddons } from './_components/my-addons';

export function AddonsMenu() {
  return (
    <PageWrapper className="space-y-4 p-4 sm:p-8">
      <Content />
    </PageWrapper>
  );
}

function Content() {
  const { status } = useStatus();
  const { mode } = useMode();
  const { userData, setUserData } = useUserData();
  const { isInherited, hasParent } = useParentInheritance();
  const [page, setPage] = useState<'installed' | 'marketplace'>('installed');
  const { tab: installedTab, setTab: setInstalledTab } = useSubTab('addons');
  const [catalogLoading, setCatalogLoading] = useState(false);

  const userDataRef = useRef(userData);
  useEffect(() => {
    userDataRef.current = userData;
  });

  const fetchCatalogsData = useCallback(async (hideToast = false) => {
    const userData = userDataRef.current;
    setCatalogLoading(true);
    try {
      const catalogs = await fetchCatalogs(userData);
      setUserData((prev) => {
        const existingMods = prev.catalogModifications || [];
        const existingIds = new Set(
          existingMods.map((mod) => `${mod.id}-${mod.type}`)
        );
        const modifications = existingMods.map((eMod) => {
          if (eMod.id.startsWith('aiostreams.merged.')) return eMod;
          const nMod = catalogs.find(
            (c) => c.id === eMod.id && c.type === eMod.type
          );
          if (nMod) {
            return {
              ...eMod,
              addonName: nMod.addonName,
              type: nMod.type,
              hideable: nMod.hideable,
              searchable: nMod.searchable,
            };
          }
          return eMod;
        });
        catalogs.forEach((catalog) => {
          if (!existingIds.has(`${catalog.id}-${catalog.type}`)) {
            modifications.push({
              id: catalog.id,
              name: catalog.name,
              type: catalog.type,
              enabled: true,
              shuffle: false,
              usePosterService: !!(
                userData.rpdbApiKey ||
                userData.topPosterApiKey ||
                userData.aioratingsApiKey
              ),
              hideable: catalog.hideable,
              searchable: catalog.searchable,
              addonName: catalog.addonName,
            });
          }
        });
        const newCatalogIds = new Set(catalogs.map((c) => `${c.id}-${c.type}`));
        const mergedCatalogIds = new Set(
          (prev.mergedCatalogs || []).map((mc) => mc.id)
        );
        const filteredMods = modifications.filter(
          (mod) =>
            (mod.id.startsWith('aiostreams.merged.') &&
              mergedCatalogIds.has(mod.id)) ||
            newCatalogIds.has(`${mod.id}-${mod.type}`)
        );
        return { ...prev, catalogModifications: filteredMods };
      });
      if (!hideToast) toast.success('Catalogs fetched successfully');
    } catch (error) {
      console.error('Error fetching catalogs:', error);
      if (error instanceof APIError) {
        toast.error((error as APIError).message);
      } else {
        toast.error('Failed to fetch catalogs');
      }
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  // Initial catalog fetch - fires once when the menu mounts.
  useEffect(() => {
    fetchCatalogsData(true);
  }, []);

  const [search, setSearch] = useState('');
  // Filter states
  const [marketplaceCategoryFilter, setMarketplaceCategoryFilter] = useState<
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

  // Filtering and search for marketplace
  const filteredPresets = useMemo(() => {
    if (!status?.settings?.presets) return [];
    let filtered = [
      ...status.settings.presets.filter((n) => !n.DISABLED?.removed),
    ];
    if (marketplaceCategoryFilter !== 'all') {
      filtered = filtered.filter(
        (n) =>
          (n.CATEGORY || constants.PresetCategory.STREAMS) ===
          marketplaceCategoryFilter
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
  }, [
    status,
    search,
    marketplaceCategoryFilter,
    serviceFilter,
    streamTypeFilter,
  ]);

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
      const newPreset = {
        type: modalPreset.ID,
        instanceId: getUniqueId(),
        enabled: true,
        options: values.options,
      };
      const newKey = getPresetUniqueKey(newPreset);
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

  // Handler for editing from My Addons
  function handleEditFromMyAddons(preset: any, presetMetadata: any) {
    setModalPreset(presetMetadata);
    setModalInitialValues({
      options: { ...preset.options },
    });
    setModalMode('edit');
    setEditingAddonId(preset.instanceId);
    setModalOpen(true);
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
            initial={{ opacity: 0, y: 60 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.99 }}
            transition={{
              duration: 0.35,
            }}
            key="installed"
            className="pt-0 space-y-6 relative z-[4]"
          >
            <>
              <div>
                <div className="flex items-center gap-2">
                  <h2>Installed</h2>
                  {hasParent && isInherited('presets') && (
                    <InheritedBadge section="presets" />
                  )}
                </div>
                <p className="text-[--muted] text-sm">
                  Manage your installed addons and catalog settings.
                </p>
              </div>
              <MenuTabs
                activeTab={installedTab}
                onTabChange={(v) => setInstalledTab(v)}
                defaultMobileOpen="addons"
                tabs={[
                  {
                    value: 'addons',
                    label: 'Addons',
                    icon: <IoExtensionPuzzle className="w-4 h-4" />,
                    content: (
                      <div className="space-y-6">
                        <MyAddons onEdit={handleEditFromMyAddons} />
                        {userData.presets.length > 0 && mode === 'pro' && (
                          <AddonFetchingBehaviorCard />
                        )}
                      </div>
                    ),
                  },
                  {
                    value: 'catalogs',
                    label: 'Catalogs',
                    icon: <MdOutlineDataset className="w-4 h-4" />,
                    content: (
                      <div className="space-y-6">
                        {userData.presets.length === 0 ? (
                          <Card className="p-8 text-center">
                            <p className="text-[--muted]">
                              Install some addons first to configure catalogs.
                            </p>
                          </Card>
                        ) : (
                          <>
                            <CatalogSettingsCard
                              loading={catalogLoading}
                              fetchCatalogsData={fetchCatalogsData}
                            />
                            <MergedCatalogsCard />
                          </>
                        )}
                      </div>
                    ),
                  },
                ]}
              />
            </>
          </PageWrapper>
        )}

        {page === 'marketplace' && (
          <PageWrapper
            initial={{ opacity: 0, y: 60 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.99 }}
            transition={{
              duration: 0.35,
            }}
            key="marketplace"
            className="pt-0 space-y-6 relative z-[4]"
          >
            <>
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
                    isCurrent: marketplaceCategoryFilter === 'all',
                    onClick: () => setMarketplaceCategoryFilter('all'),
                  },
                  {
                    name: 'Streams',
                    isCurrent:
                      marketplaceCategoryFilter ===
                      constants.PresetCategory.STREAMS,
                    onClick: () =>
                      setMarketplaceCategoryFilter(
                        constants.PresetCategory.STREAMS
                      ),
                  },
                  {
                    name: 'Subtitles',
                    isCurrent:
                      marketplaceCategoryFilter ===
                      constants.PresetCategory.SUBTITLES,
                    onClick: () =>
                      setMarketplaceCategoryFilter(
                        constants.PresetCategory.SUBTITLES
                      ),
                  },
                  {
                    name: 'Metadata & Catalogs',
                    isCurrent:
                      marketplaceCategoryFilter ===
                      constants.PresetCategory.META_CATALOGS,
                    onClick: () =>
                      setMarketplaceCategoryFilter(
                        constants.PresetCategory.META_CATALOGS
                      ),
                  },
                  {
                    name: 'Miscellaneous',
                    isCurrent:
                      marketplaceCategoryFilter ===
                      constants.PresetCategory.MISC,
                    onClick: () =>
                      setMarketplaceCategoryFilter(
                        constants.PresetCategory.MISC
                      ),
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
            </>
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
  return JSON.stringify({
    type: preset.type,
    enabled: preset.enabled,
    options: preset.options,
  });
}
