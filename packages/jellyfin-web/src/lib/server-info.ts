import React from 'react';
import { useQuery } from '@tanstack/react-query';
import type { JellyfinClient } from './client';
import type { Branding } from './types';

/** The extensions a server can offer; the server lists them in `system.ts`. */
export type Feature =
  | 'configSignIn'
  | 'configure'
  | 'users'
  | 'history'
  | 'playedUpTo'
  | 'dropped'
  | 'refreshVersions';

/** What a server's public info says about it. */
export interface ServerInfo extends Branding {
  pinSignIn: boolean;
  /** Each extension it implements, with its version. */
  features: Partial<Record<Feature, number>>;
}

export const NO_SERVER_INFO: ServerInfo = {
  name: null,
  logo: null,
  pinSignIn: false,
  features: {},
};

interface PublicSystemInfo {
  ServerName?: string;
  aiostreams?: {
    logo?: string | null;
    pinSignIn?: boolean;
    features?: ServerInfo['features'];
  };
}

const ServerInfoContext = React.createContext<ServerInfo>(NO_SERVER_INFO);
export const ServerInfoProvider = ServerInfoContext.Provider;

export function useServerInfo(): ServerInfo {
  return React.useContext(ServerInfoContext);
}

export function useFeature(feature: Feature): boolean {
  return !!useServerInfo().features[feature];
}

/**
 * The server's public info. A signed-in client asks with its token, since the
 * configuration it signed in to can rename the server.
 */
export function useServerInfoQuery(client: JellyfinClient) {
  return useQuery({
    queryKey: ['jf-server-info', client.base, client.token],
    queryFn: async (): Promise<ServerInfo> => {
      const data = await client.get<PublicSystemInfo>('/System/Info/Public');
      return {
        name: data.ServerName ?? null,
        logo: data.aiostreams?.logo ?? null,
        pinSignIn: data.aiostreams?.pinSignIn ?? false,
        features: data.aiostreams?.features ?? {},
      };
    },
    staleTime: 5 * 60_000,
  });
}
