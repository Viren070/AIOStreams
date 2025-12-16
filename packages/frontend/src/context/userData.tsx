import React from 'react';
import { UserData } from '@aiostreams/core';
import {
  QUALITIES,
  RESOLUTIONS,
  SERVICE_DETAILS,
} from '../../../core/src/utils/constants';
import { useStatus } from './status';

const USER_DATA_KEY = 'aiostreams-user-data';

export function applyMigrations(config: any): UserData {
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
      statsToShow: ['addon', 'filter'],
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
      (config as any)[key] = (config as any)[key].map((expr: unknown) =>
        typeof expr === 'string'
          ? migrateAnimeQueryTypeInExpression(expr)
          : expr
      );
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

  return config;
}
const DefaultUserData: UserData = {
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
        key: 'resolution',
        direction: 'desc',
      },
      {
        key: 'library',
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
        key: 'size',
        direction: 'desc',
      },
    ],
  },
  deduplicator: {
    enabled: true,
    keys: ['filename', 'infoHash'],
    multiGroupBehaviour: 'aggressive',
    cached: 'single_result',
    uncached: 'per_service',
    p2p: 'single_result',
  },
};

interface UserDataContextType {
  userData: UserData;
  setUserData: (data: ((prev: UserData) => UserData | null) | null) => void;
  uuid: string | null;
  setUuid: (uuid: string | null) => void;
  password: string | null;
  setPassword: (password: string | null) => void;
  encryptedPassword: string | null;
  setEncryptedPassword: (encryptedPassword: string | null) => void;
}

const UserDataContext = React.createContext<UserDataContextType | undefined>(
  undefined
);

export function UserDataProvider({ children }: { children: React.ReactNode }) {
  const { status } = useStatus();

  // Initialize userData from local storage or apply default
  const [userData, setUserData] = React.useState<UserData>(() => {
    try {
      const stored = localStorage.getItem(USER_DATA_KEY);
      const data = stored ? JSON.parse(stored) : DefaultUserData;
      return applyMigrations(data);
    } catch {
      return DefaultUserData;
    }
  });

  const [uuid, setUuid] = React.useState<string | null>(null);
  const [password, setPassword] = React.useState<string | null>(null);
  const [encryptedPassword, setEncryptedPassword] = React.useState<
    string | null
  >(null);

  // Effect to persist userData to local storage
  React.useEffect(() => {
    localStorage.setItem(USER_DATA_KEY, JSON.stringify(userData));
  }, [userData]);

  // Effect to apply forced and default values from status
  React.useEffect(() => {
    if (!status) return;

    const forced = status.settings.forced;
    const defaults = status.settings.defaults;
    const services = status.settings.services;

    setUserData((prev) => {
      const newData = { ...prev };
      newData.proxy = {
        ...newData.proxy,
        enabled: forced.proxy.enabled ?? defaults.proxy?.enabled ?? undefined,
        id: (forced.proxy.id ?? defaults.proxy?.id ?? 'builtin') as
          | 'builtin'
          | 'mediaflow'
          | 'stremthru'
          | undefined,
        url: forced.proxy.url ?? defaults.proxy?.url ?? undefined,
        publicUrl:
          forced.proxy.publicUrl ?? defaults.proxy?.publicUrl ?? undefined,
        publicIp:
          forced.proxy.publicIp ?? defaults.proxy?.publicIp ?? undefined,
        credentials:
          forced.proxy.credentials ?? defaults.proxy?.credentials ?? undefined,
        proxiedServices:
          forced.proxy.proxiedServices ?? defaults.proxy?.proxiedServices ?? [],
      };

      newData.services = (newData.services ?? []).map((service) => {
        const serviceMeta = services[service.id];
        if (!serviceMeta) return service;
        serviceMeta.credentials.forEach((credential) => {
          if (credential.forced) {
            service.credentials[credential.id] = credential.forced;
          } else if (credential.default) {
            service.credentials[credential.id] = credential.default;
          }
        });
        // enable if every credential is set
        service.enabled = serviceMeta.credentials.every(
          (credential) =>
            credential.forced ||
            credential.default ||
            service.credentials[credential.id] !== undefined
        );
        return service;
      });

      return newData;
    });
  }, [status]);

  const safeSetUserData = (
    data: ((prev: UserData) => UserData | null) | null
  ) => {
    if (data === null) {
      setUserData(DefaultUserData);
    } else {
      setUserData((prev) => {
        const result = data(prev);
        return result === null ? DefaultUserData : result;
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
