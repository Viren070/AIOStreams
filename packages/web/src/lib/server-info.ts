import React from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { JellyfinClient } from './client';
import type { Branding } from './types';

/** The extensions a server can offer; the server lists them in `system.ts`. */
export type Feature =
  | 'configSignIn'
  | 'users'
  | 'history'
  | 'playedUpTo'
  | 'dropped'
  | 'refreshVersions'
  | 'versions'
  | 'genreRequired'
  | 'fillers';

/** What a server's public info says about it. */
export interface ServerInfo extends Branding {
  /** Where the account behind this server is configured. */
  configureUrl: string | null;
  pinSignIn: boolean;
  /** A user's own sign-in address, which signs in that user alone. */
  personal: boolean;
  /** Each extension it implements, with its version. */
  features: Partial<Record<Feature, number>>;
  /** The server's build, like `v2.35.0` or `nightly a1b2c3d4`. */
  version: string | null;
}

export const NO_SERVER_INFO: ServerInfo = {
  name: null,
  logo: null,
  configureUrl: null,
  pinSignIn: false,
  personal: false,
  features: {},
  version: null,
};

interface PublicSystemInfo {
  ServerName?: string;
  aiostreams?: {
    logo?: string | null;
    configureUrl?: string | null;
    pinSignIn?: boolean;
    personal?: boolean;
    features?: ServerInfo['features'];
    version?: { tag?: string; channel?: string; commit?: string };
  };
}

function buildVersion(
  build: NonNullable<PublicSystemInfo['aiostreams']>['version']
): string | null {
  const known = (v?: string) => (v && v !== 'unknown' ? v : null);
  const tag = known(build?.tag);
  const commit = known(build?.commit);
  if (build?.channel === 'nightly' || build?.channel === 'dev')
    return commit ? `${build.channel} ${commit}` : build.channel;
  return tag;
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
    meta: { cache: 'account' },
    queryFn: async (): Promise<ServerInfo> => {
      const data = await client.get<PublicSystemInfo>('/System/Info/Public');
      return {
        name: data.ServerName ?? null,
        logo: data.aiostreams?.logo ?? null,
        configureUrl: data.aiostreams?.configureUrl ?? null,
        pinSignIn: data.aiostreams?.pinSignIn ?? false,
        personal: data.aiostreams?.personal ?? false,
        features: data.aiostreams?.features ?? {},
        version: buildVersion(data.aiostreams?.version),
      };
    },
    staleTime: 5 * 60_000,
    // A new token asks again; the screen fading out meanwhile must not change.
    placeholderData: keepPreviousData,
  });
}
