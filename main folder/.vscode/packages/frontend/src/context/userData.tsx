import React from 'react';
import { UserData } from '@aiostreams/core';
import {
  QUALITIES,
  RESOLUTIONS,
  SERVICE_DETAILS,
} from '../../../core/src/utils/constants';
import { useStatus } from './status';

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
        key: 'library',
        direction: 'desc',
      },
      {
        key: 'resolution',
        direction: 'desc',
      },
      {
        key: 'size',
        direction: 'desc',
      },
    ],
  },
  deduplicator: {
    enabled: false,
    keys: ['filename', 'infoHash'],
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
  const [userData, setUserData] = React.useState<UserData>(DefaultUserData);
  const [uuid, setUuid] = React.useState<string | null>(null);
  const [password, setPassword] = React.useState<string | null>(null);
  const [encryptedPassword, setEncryptedPassword] = React.useState<
    string | null
  >(null);

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
        id: (forced.proxy.id ?? defaults.proxy?.id ?? 'mediaflow') as
          | 'mediaflow'
          | 'stremthru'
          | undefined,
        url: forced.proxy.url ?? defaults.proxy?.url ?? undefined,
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
      setUserData((prev) => ({
        ...prev,
        ...DefaultUserData,
      }));
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
