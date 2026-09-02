import React from 'react';
import { UserData } from '@aiostreams/core';
import {
  QUALITIES,
  RESOLUTIONS,
  SERVICE_DETAILS,
  DEFAULT_PRECACHE_SELECTOR,
  DEFAULT_SMART_DETECT_ATTRIBUTES,
  DEFAULT_FAILOVER_CONTENT_TYPES,
  DEFAULT_FAILOVER_PARALLEL,
} from '../../../core/src/utils/constants';
import { useStatus } from './status';
import { filterForDiff } from '../utils/diff/userData';
import {
  clearDrafts,
  isDraftOptOut,
  migrateLegacyDraft,
  readAnyLocalDraft,
  readSessionDraft,
  setDraftOptOut,
  writeLocalDraft,
  writeSessionDraft,
  type Draft,
} from '@/lib/drafts';

export function applyMigrations(config: any): UserData {
  if (
    config &&
    config.addonPassword !== undefined &&
    config.accessToken === undefined
  ) {
    config.accessToken = config.addonPassword;
  }
  if (config && config.addonPassword !== undefined) {
    delete config.addonPassword;
  }
  if (
    config &&
    config.accessToken !== undefined &&
    config.accessKey === undefined
  ) {
    config.accessKey = config.accessToken;
  }
  if (config && config.accessToken !== undefined) {
    delete config.accessToken;
  }
  if (
    config.deduplicator &&
    typeof config.deduplicator.multiGroupBehaviour === 'string'
  ) {
    switch (config.deduplicator.multiGroupBehaviour as string) {
      case 'remove_uncached':
        config.deduplicator.multiGroupBehaviour = 'aggressive';
        break;
      case 'remove_uncached_same_service':
        config.deduplicator.multiGroupBehaviour = 'conservative';
        break;
      case 'remove_nothing':
        config.deduplicator.multiGroupBehaviour = 'keep_all';
        break;
    }
  }

  if (typeof config.digitalReleaseFilter === 'boolean') {
    const oldValue = config.digitalReleaseFilter;
    config.digitalReleaseFilter = {
      enabled: oldValue,
      tolerance: 0,
      requestTypes: ['movie', 'series', 'anime'],
      addons: [],
    };
  }
  if (config.titleMatching?.matchYear) {
    config.yearMatching = {
      enabled: true,
      tolerance: config.titleMatching.yearTolerance
        ? config.titleMatching.yearTolerance
        : 1,
      requestTypes: config.titleMatching.requestTypes ?? [],
      addons: config.titleMatching.addons ?? [],
    };
    delete config.titleMatching.matchYear;
  }

  if (Array.isArray(config.groups)) {
    config.groups = {
      enabled: config.disableGroups ? false : true,
      groupings: config.groups,
      behaviour: 'parallel',
    };
  }

  if (config.showStatistics || config.statisticsPosition) {
    config.statistics = {
      enabled: config.showStatistics ?? false,
      position: config.statisticsPosition ?? 'bottom',
      statsToShow: ['addon', 'filter', 'timing'],
      ...(config.statistics ?? {}),
    };
    delete config.showStatistics;
    delete config.statisticsPosition;
  }

  const migrateHOSBS = (
    type: 'preferred' | 'required' | 'excluded' | 'included'
  ) => {
    if (Array.isArray(config[type + 'Encodes'])) {
      config[type + 'Encodes'] = config[type + 'Encodes'].filter(
        (encode: string) => {
          if (encode === 'H-OU' || encode === 'H-SBS') {
            config[type + 'VisualTags'] = [
              ...(config[type + 'VisualTags'] ?? []),
              encode,
            ];
            return false;
          }
          return true;
        }
      );
    }
  };

  migrateHOSBS('preferred');
  migrateHOSBS('required');
  migrateHOSBS('excluded');
  migrateHOSBS('included');

  // migrate comparisons of queryType to 'anime' to 'anime.series' or 'anime.movie'
  const migrateAnimeQueryTypeInExpression = (expr?: string) => {
    if (typeof expr !== 'string') return expr as any;
    let updated = expr.replace(
      /queryType\s*==\s*(["'])anime\1/g,
      "(queryType == 'anime.series' or queryType == 'anime.movie')"
    );
    updated = updated.replace(
      /(["'])anime\1\s*==\s*queryType/g,
      "(queryType == 'anime.series' or queryType == 'anime.movie')"
    );
    updated = updated.replace(
      /queryType\s*!=\s*(["'])anime\1/g,
      "(queryType != 'anime.series' and queryType != 'anime.movie')"
    );
    updated = updated.replace(
      /(["'])anime\1\s*!=\s*queryType/g,
      "(queryType != 'anime.series' and queryType != 'anime.movie')"
    );
    return updated;
  };

  const expressionLists = [
    'excludedStreamExpressions',
    'requiredStreamExpressions',
    'includedStreamExpressions',
    'preferredStreamExpressions',
  ] as const;

  for (const key of expressionLists) {
    if (Array.isArray((config as any)[key])) {
      (config as any)[key] = (config as any)[key].map((expr: unknown) => {
        if (typeof expr === 'string') {
          return migrateAnimeQueryTypeInExpression(expr);
        }
        if (typeof expr === 'object' && expr !== null && 'expression' in expr) {
          return {
            ...(expr as any),
            expression: migrateAnimeQueryTypeInExpression(
              (expr as any).expression
            ),
          };
        }
        return expr;
      });
    }
  }

  if (config.dynamicAddonFetching?.condition) {
    config.dynamicAddonFetching.condition = migrateAnimeQueryTypeInExpression(
      config.dynamicAddonFetching.condition
    );
  }

  if (config.groups?.groupings) {
    config.groups.groupings = config.groups.groupings.map((group: any) => ({
      ...group,
      condition: migrateAnimeQueryTypeInExpression(group.condition),
    }));
  }

  if (
    config.rpdbUseRedirectApi !== undefined &&
    config.usePosterRedirectApi === undefined
  ) {
    config.usePosterRedirectApi = config.rpdbUseRedirectApi;
    delete config.rpdbUseRedirectApi;
  }

  // migrate 'rpdb' to 'usePosterService' in all catalog modifications
  if (Array.isArray(config.catalogModifications)) {
    for (const mod of config.catalogModifications) {
      if (mod.usePosterService === undefined && mod.rpdb === true) {
        mod.usePosterService = true;
      }
      delete mod.rpdb;
    }
  }

  // migrate alwaysPrecache to precacheCondition, then precacheCondition to precacheSelector
  if (config.precacheSelector === undefined && config.precacheNextEpisode) {
    // First handle the old precacheCondition field
    if (config.precacheCondition !== undefined) {
      // Convert condition to selector format
      config.precacheSelector = `${config.precacheCondition} ? uncached(streams) : []`;
    } else {
      // Handle even older alwaysPrecache field
      config.precacheSelector =
        config.alwaysPrecache === true
          ? 'true ? uncached(streams) : []'
          : DEFAULT_PRECACHE_SELECTOR;
    }
  }
  delete config.alwaysPrecache;
  delete config.precacheCondition;

  // migrate p2pWrap to serviceWrap
  if (config.p2pWrap !== undefined && config.serviceWrap === undefined) {
    config.serviceWrap = config.p2pWrap;
    delete config.p2pWrap;
  }

  // migrate nzbFailover -> generic failover (usenet-only, sequential = old behaviour)
  if (config.failover === undefined && config.nzbFailover !== undefined) {
    config.failover = {
      enabled: config.nzbFailover.enabled,
      maxAttempts: config.nzbFailover.count,
      position: config.nzbFailover.position,
      contentTypes: [...DEFAULT_FAILOVER_CONTENT_TYPES],
      allowCrossType: false,
      parallel: DEFAULT_FAILOVER_PARALLEL,
    };
  }
  delete config.nzbFailover;

  // migrate failover.count -> failover.maxAttempts (renamed)
  if (config.failover && (config.failover as any).count !== undefined) {
    config.failover.maxAttempts ??= (config.failover as any).count;
    delete (config.failover as any).count;
  }

  // migrate stream expressions from string[] to {expression, enabled}[]
  const streamExpressionKeys = [
    'excludedStreamExpressions',
    'requiredStreamExpressions',
    'preferredStreamExpressions',
    'includedStreamExpressions',
  ] as const;
  for (const key of streamExpressionKeys) {
    if (
      Array.isArray(config[key]) &&
      config[key].some((expr: unknown) => typeof expr === 'string')
    ) {
      config[key] = config[key].map((expr: unknown) =>
        typeof expr === 'string' ? { expression: expr, enabled: true } : expr
      );
    }
  }

  // migrate forceToTop at addon level to pinPosition set to 'top'
  if (config.presets && Array.isArray(config.presets)) {
    config.presets = config.presets.map((preset: any) => {
      if (
        preset.options?.forceToTop === true &&
        preset.options.pinPosition === undefined
      ) {
        delete preset.options.forceToTop;
        return {
          ...preset,
          options: {
            ...preset.options,
            pinPosition: 'top',
          },
        };
      }
      return preset;
    });
  }

  // migrate nab url/apiKey/apiPath options into a single `api` object holding
  // the complete endpoint
  if (config.presets && Array.isArray(config.presets)) {
    // [urlOption, apiKeyOption, urlIsBaseOnly]
    const nabOptionKeys: Record<string, [string, string, boolean?]> = {
      newznab: ['newznabUrl', 'apiKey'],
      torznab: ['torznabUrl', 'apiKey'],
      nzbhydra: ['nzbhydraUrl', 'nzbhydraApiKey', true],
    };
    config.presets = config.presets.map((preset: any) => {
      const keys = nabOptionKeys[preset.type];
      if (!keys || !preset.options || preset.options.api !== undefined) {
        return preset;
      }
      const [urlKey, apiKeyKey, urlIsBaseOnly] = keys;
      const {
        [urlKey]: url,
        [apiKeyKey]: apiKey,
        apiPath,
        ...rest
      } = preset.options;
      if (url === undefined && apiKey === undefined && apiPath === undefined) {
        return preset;
      }
      const api: { url?: string; apiKey?: string } = {};
      // a preconfigured NZBHydra stores no url, and must not gain a bare '/api'
      if (typeof url === 'string' && url.trim()) {
        const base = url.trim().replace(/\/+$/, '');
        if (urlIsBaseOnly) {
          api.url = base;
        } else {
          const path = apiPath === undefined ? '/api' : String(apiPath).trim();
          const normalised = path.replace(/^\/+|\/+$/g, '');
          api.url = base + (normalised ? `/${normalised}` : '');
        }
      }
      if (apiKey !== undefined) {
        api.apiKey = apiKey;
      }
      return { ...preset, options: { ...rest, api } };
    });
  }

  if (config.formatter && config.formatter.definition) {
    config.formatter.definitions = {
      ...(config.formatter.definitions ?? {}),
      custom: config.formatter.definition,
    };
    delete config.formatter.definition;
  }

  return config;
}

export function removeInvalidPresetReferences(config: UserData) {
  // remove references to non-existent presets in options:
  const existingPresetIds = config.presets?.map((preset) => preset.instanceId);
  if (config.proxy) {
    config.proxy.proxiedAddons = config.proxy.proxiedAddons?.filter((addon) =>
      existingPresetIds?.includes(addon)
    );
  }
  if (config.yearMatching) {
    config.yearMatching.addons = config.yearMatching.addons?.filter((addon) =>
      existingPresetIds?.includes(addon)
    );
  }
  if (config.titleMatching) {
    config.titleMatching.addons = config.titleMatching.addons?.filter((addon) =>
      existingPresetIds?.includes(addon)
    );
  }
  if (config.seasonEpisodeMatching) {
    config.seasonEpisodeMatching.addons =
      config.seasonEpisodeMatching.addons?.filter((addon) =>
        existingPresetIds?.includes(addon)
      );
  }
  if (config.episodeTitleMatching) {
    config.episodeTitleMatching.addons =
      config.episodeTitleMatching.addons?.filter((addon) =>
        existingPresetIds?.includes(addon)
      );
  }
  if (config.groups?.groupings) {
    config.groups.groupings = config.groups.groupings.map((group) => ({
      ...group,
      addons: group.addons?.filter((addon) =>
        existingPresetIds?.includes(addon)
      ),
    }));
  }
  if (config.serviceWrap?.presets) {
    config.serviceWrap.presets = config.serviceWrap.presets.filter((preset) =>
      existingPresetIds?.includes(preset)
    );
  }
  return config;
}
export const DefaultUserData: UserData = {
  services: Object.values(SERVICE_DETAILS).map((service) => ({
    id: service.id,
    enabled: false,
    credentials: {},
  })),
  presets: [],
  formatter: {
    id: 'gdrive',
  },
  preferredQualities: Object.values(QUALITIES),
  preferredResolutions: Object.values(RESOLUTIONS),
  excludedQualities: ['CAM', 'SCR', 'TS', 'TC'],
  excludedVisualTags: ['3D'],
  sortCriteria: {
    global: [
      {
        key: 'cached',
        direction: 'desc',
      },
      {
        key: 'library',
        direction: 'desc',
      },
      {
        key: 'resolution',
        direction: 'desc',
      },
      {
        key: 'quality',
        direction: 'desc',
      },
      {
        key: 'streamExpressionScore',
        direction: 'desc',
      },
      {
        key: 'regexPatterns',
        direction: 'desc',
      },
      {
        key: 'streamType',
        direction: 'desc',
      },
      {
        key: 'visualTag',
        direction: 'desc',
      },
      {
        key: 'audioTag',
        direction: 'desc',
      },
      {
        key: 'audioChannel',
        direction: 'desc',
      },
      {
        key: 'encode',
        direction: 'desc',
      },
      {
        key: 'language',
        direction: 'desc',
      },
      {
        key: 'subtitle',
        direction: 'desc',
      },
      {
        key: 'size',
        direction: 'desc',
      },
    ],
  },
  posterService: 'rpdb',
  deduplicator: {
    enabled: true,
    keys: ['filename', 'infoHash'],
    multiGroupBehaviour: 'aggressive',
    cached: 'single_result',
    uncached: 'per_service',
    p2p: 'single_result',
    http: 'disabled',
    live: 'disabled',
    youtube: 'disabled',
    external: 'disabled',
    smartDetectAttributes: DEFAULT_SMART_DETECT_ATTRIBUTES,
    smartDetectRounding: 10,
    libraryBehaviour: 'ignore',
  },
  autoPlay: {
    enabled: true,
    method: 'matchingFile',
    attributes: ['resolution', 'quality', 'releaseGroup'],
  },
  cacheAndPlay: {
    enabled: false,
    streamTypes: ['usenet'],
  },
  statistics: {
    enabled: false,
    position: 'bottom',
    statsToShow: ['addon', 'filter', 'timing'],
    showFilterStatsOnNoStreams: true,
  },
  digitalReleaseFilter: {
    enabled: false,
    tolerance: 0,
    requestTypes: [],
    addons: [],
    showInfoOnFilter: true,
  },
  ageRangeTypes: ['usenet'],
  seasonEpisodeMatching: {
    addons: [],
    requestTypes: [],
  },
  episodeTitleMatching: {
    addons: [],
    requestTypes: [],
  },
  languageInference: {
    enabled: true,
    sources: [],
  },
  yearMatching: {
    addons: [],
    requestTypes: [],
  },
  titleMatching: {
    addons: [],
    requestTypes: [],
  },
  precacheNextEpisode: false,
  precacheSingleStream: true,
  precacheSelector: DEFAULT_PRECACHE_SELECTOR,
  enableSeadex: true,
  regexOverrides: [],
  checkOwned: true,
};

type Status = NonNullable<ReturnType<typeof useStatus>['status']>;

/**
 * Overlays the instance's forced and default settings. Applied to both the live
 * configuration and the draft baseline, so it must not mutate its input.
 */
function applyStatusDefaults(data: UserData, status: Status): UserData {
  const forced = status.settings.forced;
  const defaults = status.settings.defaults;
  const services = status.settings.services;

  const next: UserData = { ...data };
  next.proxy = {
    ...next.proxy,
    enabled: forced.proxy.enabled ?? defaults.proxy?.enabled ?? undefined,
    id: (forced.proxy.id ?? defaults.proxy?.id ?? 'builtin') as
      | 'builtin'
      | 'mediaflow'
      | 'stremthru'
      | undefined,
    url: forced.proxy.url ?? defaults.proxy?.url ?? undefined,
    publicUrl: forced.proxy.publicUrl ?? defaults.proxy?.publicUrl ?? undefined,
    publicIp: forced.proxy.publicIp ?? defaults.proxy?.publicIp ?? undefined,
    credentials:
      forced.proxy.credentials ?? defaults.proxy?.credentials ?? undefined,
    proxiedServices:
      forced.proxy.proxiedServices ?? defaults.proxy?.proxiedServices ?? [],
  };

  next.services = (data.services ?? []).map((service) => {
    const serviceMeta = services[service.id];
    if (!serviceMeta) return service;
    const credentials = { ...service.credentials };
    serviceMeta.credentials.forEach((credential) => {
      if (credential.forced) {
        credentials[credential.id] = credential.forced;
      } else if (credential.default) {
        credentials[credential.id] = credential.default;
      }
    });
    return {
      ...service,
      credentials,
      // enable if every credential is set
      enabled: serviceMeta.credentials.every(
        (credential) =>
          credential.forced ||
          credential.default ||
          credentials[credential.id] !== undefined
      ),
    };
  });

  return next;
}

/** Stable comparison that ignores identity and other volatile fields. */
function sameConfig(a: UserData, b: UserData): boolean {
  return JSON.stringify(filterForDiff(a)) === JSON.stringify(filterForDiff(b));
}

/** Whether a configuration holds work worth offering to restore. */
function hasWork(data: UserData): boolean {
  return (
    (data.presets ?? []).length > 0 ||
    (data.services ?? []).some((service) => service.enabled)
  );
}

interface UserDataContextType {
  userData: UserData;
  setUserData: (data: ((prev: UserData) => UserData | null) | null) => void;
  uuid: string | null;
  setUuid: (uuid: string | null) => void;
  password: string | null;
  setPassword: (password: string | null) => void;
  encryptedPassword: string | null;
  setEncryptedPassword: (encryptedPassword: string | null) => void;
  /** Edits past this point count as a draft; matching it again clears one. */
  setBaseline: (data: UserData) => void;
  /** Null unless it belongs to the configuration currently held. */
  pendingDraft: Draft | null;
  restoreDraft: () => void;
  discardDraft: () => void;
  /** Discards the draft and stops keeping drafts on this browser. */
  disableDrafts: () => void;
}

const UserDataContext = React.createContext<UserDataContextType | undefined>(
  undefined
);

export function UserDataProvider({ children }: { children: React.ReactNode }) {
  const { status } = useStatus();

  // Only a same-tab reload restores silently; anything older is offered.
  const [boot] = React.useState(() => {
    migrateLegacyDraft(hasWork);
    const session = readSessionDraft();
    if (session && session.uuid === null) {
      try {
        return { initial: applyMigrations(session.data), pending: null };
      } catch {
        /* fall through to the prompt */
      }
    }
    return {
      initial: DefaultUserData,
      pending: session ?? readAnyLocalDraft(),
    };
  });

  const [userData, setUserData] = React.useState<UserData>(boot.initial);
  const [pendingDraft, setPendingDraft] = React.useState<Draft | null>(
    boot.pending
  );

  const [uuid, setUuid] = React.useState<string | null>(null);
  const [password, setPassword] = React.useState<string | null>(null);
  const [encryptedPassword, setEncryptedPassword] = React.useState<
    string | null
  >(null);

  // Last configuration known to be saved; a draft exists only while it differs.
  const baselineRef = React.useRef<UserData>(DefaultUserData);
  const anonBaselineRef = React.useRef<UserData>(DefaultUserData);
  const [baselineReady, setBaselineReady] = React.useState(false);

  const setBaseline = React.useCallback((data: UserData) => {
    baselineRef.current = data;
  }, []);

  const statusApplied = React.useRef(false);

  React.useEffect(() => {
    if (!status || statusApplied.current) return;
    statusApplied.current = true;

    // The baseline takes the same overlay, or defaults read as unsaved edits.
    const anonBaseline = applyStatusDefaults(DefaultUserData, status);
    anonBaselineRef.current = anonBaseline;
    baselineRef.current = anonBaseline;
    setUserData((prev) => applyStatusDefaults(prev, status));
    setBaselineReady(true);
  }, [status]);

  React.useEffect(() => {
    if (!baselineReady) return;
    const handle = setTimeout(() => {
      if (sameConfig(userData, baselineRef.current)) {
        clearDrafts(uuid);
        return;
      }
      writeSessionDraft(userData, uuid, userData.addonName);
      writeLocalDraft(userData, uuid, userData.addonName);
    }, 400);
    return () => clearTimeout(handle);
  }, [userData, uuid, baselineReady]);

  const restoreDraft = React.useCallback(() => {
    setPendingDraft((draft) => {
      if (draft) {
        try {
          const restored = applyMigrations(draft.data);
          setUserData(() =>
            status ? applyStatusDefaults(restored, status) : restored
          );
        } catch {
          /* unusable draft; drop it rather than breaking the page */
        }
      }
      return null;
    });
  }, [status]);

  const discardDraft = React.useCallback(() => {
    setPendingDraft((draft) => {
      if (draft) clearDrafts(draft.uuid);
      return null;
    });
  }, []);

  const applicableDraft =
    pendingDraft && (uuid === null || pendingDraft.uuid === uuid)
      ? pendingDraft
      : null;

  const disableDrafts = React.useCallback(() => {
    setDraftOptOut();
    setPendingDraft((draft) => {
      if (draft) clearDrafts(draft.uuid);
      return null;
    });
  }, []);

  // Clearing means signing out; resetting to the baseline writes no draft.
  const safeSetUserData = (
    data: ((prev: UserData) => UserData | null) | null
  ) => {
    const reset = () => {
      baselineRef.current = anonBaselineRef.current;
      return anonBaselineRef.current;
    };
    if (data === null) {
      setUserData(reset);
    } else {
      setUserData((prev) => {
        const result = data(prev);
        return result === null ? reset() : result;
      });
    }
  };

  return (
    <UserDataContext.Provider
      value={{
        userData,
        setUserData: safeSetUserData,
        uuid,
        setUuid,
        password,
        setPassword,
        encryptedPassword,
        setEncryptedPassword,
        setBaseline,
        pendingDraft: applicableDraft,
        restoreDraft,
        discardDraft,
        disableDrafts,
      }}
    >
      {children}
    </UserDataContext.Provider>
  );
}

export function useUserData() {
  const context = React.useContext(UserDataContext);
  if (context === undefined) {
    throw new Error('useUserData must be used within a UserDataProvider');
  }
  return context;
}

export function useParentInheritance() {
  const { userData } = useUserData();
  const parentConfig = userData?.parentConfig;
  const strategies = parentConfig?.mergeStrategies;

  function isInherited(
    section:
      | 'presets'
      | 'services'
      | 'filters'
      | 'sorting'
      | 'formatter'
      | 'proxy'
      | 'metadata'
      | 'misc'
  ): boolean {
    if (!parentConfig) return false;
    const strategy = strategies?.[section] ?? 'inherit';
    return strategy === 'inherit';
  }

  return {
    hasParent: !!parentConfig,
    parentUuid: parentConfig?.uuid,
    isInherited,
  };
}
