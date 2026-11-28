import React, {
  useState,
  useMemo,
  useEffect,
  useCallback,
  useRef,
} from 'react';
import { useMutation } from '@tanstack/react-query';
import { UserData } from '@aiostreams/core';
import { useStatus } from '@/context/status';
import { useUserData } from '@/context/userData';
import { Button } from '@aiostreams/ui/button';
import { Card } from '@aiostreams/ui/card';
import { TextInput } from '@aiostreams/ui/text-input';
import { SearchIcon } from 'lucide-react';
import { StaticTabs } from '@aiostreams/ui/tabs';
import { LuSettings } from 'react-icons/lu';
import { Select } from '@aiostreams/ui/select';
import { useMode } from '@/context/mode';
import { MdOutlineDataset, MdSubtitles } from 'react-icons/md';
import { RiFolderDownloadFill } from 'react-icons/ri';
import { APIError, fetchCatalogs } from '@/lib/api';
import { toast } from 'sonner';
import * as constants from '../../../../../core/src/utils/constants';

import { AddonCard } from './_components/addon-card';
import { AddonModal } from './_components/addon-modal';
import { AddCustomAddonModal } from './_components/add-custom-addon';
import { AddonFetchingBehaviorCard } from './_components/addon-fetching-behavior';
import { CatalogSettingsCard } from './_components/catalog-settings';
import {
  addonOf,
  catalogKey,
  disabledPresets,
  presetOf,
  withUpstreamOrder,
} from './_components/catalog-order';
import {
  MergedCatalogEditor,
  type MergeRequest,
} from './_components/merged-catalogs';
import { MyAddons } from './_components/my-addons';

/** Changes whenever the catalogs the addons offer could. */
function addonSetKey(presets: UserData['presets'] | undefined): string {
  return JSON.stringify(
    (presets ?? []).map((p) => [p.instanceId, p.enabled, p.options])
  );
}

/** Fetches the catalogs when `catalogsShown`. */
export function useAddonsSections({ catalogsShown = false } = {}) {
  const { status } = useStatus();
  const { mode } = useMode();
  const { userData, setUserData } = useUserData();
  const [newCatalogs, setNewCatalogs] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const [upstreamKeys, setUpstreamKeys] = useState<string[]>([]);
  const [mergeRequest, setMergeRequest] = useState<MergeRequest | null>(null);
  const clearMergeRequest = useCallback(() => setMergeRequest(null), []);
  const addonsKey = useMemo(
    () => addonSetKey(userData.presets),
    [userData.presets]
  );
  const currentAddons = useRef(addonsKey);
  currentAddons.current = addonsKey;
  const fetchedFor = useRef<string | null>(null);
  const { mutate: fetchCatalogsData, isPending: catalogLoading } = useMutation({
    mutationFn: (currentUserData: typeof userData) =>
      fetchCatalogs(currentUserData),
    onSuccess: (catalogs, currentUserData) => {
      // Catalogs of other addons would drop every saved modification.
      if (addonSetKey(currentUserData.presets) !== currentAddons.current)
        return;
      const keys = catalogs.map(catalogKey);
      setUpstreamKeys(keys);
      const saved = currentUserData.catalogModifications ?? [];
      // A first fetch has nothing to compare against.
      if (saved.length) {
        const known = new Set(saved.map(catalogKey));
        const added = keys.filter((key) => !known.has(key));
        if (added.length)
          setNewCatalogs((current) => new Set([...current, ...added]));
      }
      setUserData((prev) => {
        const existingMods = prev.catalogModifications || [];
        const existingIds = new Set(existingMods.map(catalogKey));
        const startOff = new Set(prev.newCatalogsDisabled);
        const keepOrder = new Set(prev.upstreamCatalogOrder);
        const modifications = existingMods.map((eMod) => {
          if (eMod.id.startsWith('aiostreams.merged.')) return eMod;
          const nMod = catalogs.find(
            (c) => c.id === eMod.id && c.type === eMod.type
          );
          // Unchanged rows keep their object, so they skip re-rendering.
          if (
            nMod &&
            (nMod.addonName !== eMod.addonName ||
              nMod.type !== eMod.type ||
              nMod.hideable !== eMod.hideable ||
              nMod.genreRequired !== eMod.genreRequired ||
              nMod.searchable !== eMod.searchable)
          ) {
            return {
              ...eMod,
              addonName: nMod.addonName,
              type: nMod.type,
              hideable: nMod.hideable,
              genreRequired: nMod.genreRequired,
              searchable: nMod.searchable,
            };
          }
          return eMod;
        });
        catalogs.forEach((catalog) => {
          if (!existingIds.has(catalogKey(catalog))) {
            const addon = addonOf(catalog.id);
            const after = keepOrder.has(addon)
              ? modifications.findLastIndex((m) => addonOf(m.id) === addon)
              : -1;
            modifications.splice(
              after === -1 ? modifications.length : after + 1,
              0,
              {
                id: catalog.id,
                name: catalog.name,
                type: catalog.type,
                enabled: !startOff.has(catalog.id.split('.')[0]),
                shuffle: false,
                usePosterService: !!(
                  currentUserData.rpdbApiKey ||
                  currentUserData.topPosterApiKey ||
                  currentUserData.aioratingsApiKey
                ),
                hideable: catalog.hideable,
                genreRequired: catalog.genreRequired,
                searchable: catalog.searchable,
                addonName: catalog.addonName,
              }
            );
          }
        });
        const newCatalogIds = new Set(keys);
        const mergedCatalogIds = new Set(
          (prev.mergedCatalogs || []).map((mc) => mc.id)
        );
        // A turned-off addon lists no catalogs but keeps its settings.
        const offPresets = disabledPresets(prev.presets);
        const filteredMods = modifications.filter(
          (mod) =>
            (mod.id.startsWith('aiostreams.merged.') &&
              mergedCatalogIds.has(mod.id)) ||
            newCatalogIds.has(catalogKey(mod)) ||
            offPresets.has(presetOf(mod.id))
        );
        return {
          ...prev,
          catalogModifications: withUpstreamOrder(
            filteredMods,
            keepOrder,
            keys
          ),
        };
      });
    },
    onError: (error) => {
      fetchedFor.current = null;
      console.error('Error fetching catalogs:', error);
      if (error instanceof APIError) {
        toast.error((error as APIError).message);
      } else {
        toast.error('Failed to fetch catalogs');
      }
    },
  });

  const refreshCatalogs = useCallback(
    (hideToast = false) => {
      fetchCatalogsData(userData, {
        onSuccess: hideToast
          ? undefined
          : () => toast.success('Catalogs fetched successfully'),
      });
    },
    [fetchCatalogsData, userData]
  );

  useEffect(() => {
    if (!catalogsShown || !userData.presets?.length) return;
    if (fetchedFor.current === addonsKey) return;
    fetchedFor.current = addonsKey;
    fetchCatalogsData(userData);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogsShown, addonsKey]);

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

  const customPreset = status?.settings?.presets.find(
    (p) => p.ID === 'custom' && !p.DISABLED
  );
  const [addCustomOpen, setAddCustomOpen] = useState(false);
  const openAddCustom = customPreset ? () => setAddCustomOpen(true) : undefined;

  // AddonModal handlers
  function handleAddPreset(preset: any) {
    if (preset.ID === 'custom') {
      setAddCustomOpen(true);
      return;
    }
    setModalPreset(preset);
    setModalInitialValues({ options: defaultOptions(preset) });
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

  function installPreset(preset: any, options: Record<string, any>) {
    const newPreset = {
      type: preset.ID,
      instanceId: getUniqueId(),
      enabled: true,
      options,
    };
    const newKey = getPresetUniqueKey(newPreset);
    if (userData.presets.some((a) => getPresetUniqueKey(a) === newKey)) {
      toast.error('You already have an addon with the same options added.');
      return;
    }
    setUserData((prev) => ({
      ...prev,
      presets: [...prev.presets, newPreset],
    }));
    toast.info('Addon installed successfully!');
  }

  function handleModalSubmit(values: Record<string, any>) {
    if (modalMode === 'add' && modalPreset) {
      installPreset(modalPreset, values.options);
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
    'grid grid-cols-[repeat(auto-fill,minmax(min(100%,17rem),1fr))] gap-4';

  const installed = (
    <>
      <div className="space-y-6">
        <MyAddons onEdit={handleEditFromMyAddons} onAddCustom={openAddCustom} />
        {userData.presets.length > 0 && mode === 'pro' && (
          <AddonFetchingBehaviorCard />
        )}
      </div>
    </>
  );
  const catalogs = (
    <>
      <div className="space-y-6">
        {userData.presets.length === 0 ? (
          <Card className="p-8 text-center">
            <p className="text-[--muted]">
              Install some addons first to configure catalogs.
            </p>
          </Card>
        ) : (
          <>
            <MergedCatalogEditor
              request={mergeRequest}
              onRequestHandled={clearMergeRequest}
            />
            <CatalogSettingsCard
              loading={catalogLoading}
              fetchCatalogsData={refreshCatalogs}
              newCatalogs={newCatalogs}
              upstreamKeys={upstreamKeys}
              onMerge={setMergeRequest}
            />
          </>
        )}
      </div>
    </>
  );
  const marketplace = (
    <>
      <div>
        <h2>Marketplace</h2>
        <p className="text-[--muted] text-sm">
          Browse and install addons from the marketplace.
          {openAddCustom && (
            <>
              {' '}
              Not listed?{' '}
              <button
                type="button"
                className="text-[--brand] hover:underline"
                onClick={openAddCustom}
              >
                Add it by URL
              </button>
            </>
          )}
        </p>
      </div>

      {/* Category tabs */}
      <StaticTabs
        className="w-fit max-w-full border rounded-full py-0"
        triggerClass="px-4 py-1 text-sm h-full rounded-full"
        pillClass="rounded-full border-transparent"
        items={[
          {
            name: 'All',
            isCurrent: marketplaceCategoryFilter === 'all',
            onClick: () => setMarketplaceCategoryFilter('all'),
          },
          {
            name: 'Streams',
            isCurrent:
              marketplaceCategoryFilter === constants.PresetCategory.STREAMS,
            onClick: () =>
              setMarketplaceCategoryFilter(constants.PresetCategory.STREAMS),
          },
          {
            name: 'Subtitles',
            isCurrent:
              marketplaceCategoryFilter === constants.PresetCategory.SUBTITLES,
            onClick: () =>
              setMarketplaceCategoryFilter(constants.PresetCategory.SUBTITLES),
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
              marketplaceCategoryFilter === constants.PresetCategory.MISC,
            onClick: () =>
              setMarketplaceCategoryFilter(constants.PresetCategory.MISC),
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
        <Card className="p-8 text-center space-y-3">
          <p className="text-[--muted]">
            No addons found matching your criteria.
          </p>
          {openAddCustom && (
            <Button
              size="sm"
              intent="gray-outline"
              rounded
              onClick={openAddCustom}
            >
              Add one by URL
            </Button>
          )}
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
  );
  const modals = (
    <>
      {/* Add/Edit Addon Modal (ensure both tabs can use it)*/}
      <AddonModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        mode={modalMode}
        presetMetadata={modalPreset}
        initialValues={modalInitialValues as any}
        onSubmit={handleModalSubmit}
      />
      <AddCustomAddonModal
        open={addCustomOpen}
        onOpenChange={setAddCustomOpen}
        onSubmit={(options) => {
          if (!customPreset) return;
          installPreset(customPreset, {
            ...defaultOptions(customPreset),
            ...options,
          });
          setAddCustomOpen(false);
        }}
      />
    </>
  );
  return { installed, catalogs, marketplace, modals };
}

function defaultOptions(preset: any): Record<string, any> {
  return Object.fromEntries(
    (preset.OPTIONS || []).map((opt: any) => [
      opt.id,
      opt.forced ?? opt.default ?? undefined,
    ])
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
