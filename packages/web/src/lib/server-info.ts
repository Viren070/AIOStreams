import React from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { PartyRelayMode } from '@aiostreams/core';
import { allowHints, type JellyfinClient } from './client';
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
  | 'fillers'
  | 'parties'
  | 'reports'
  | 'clientHints'
  | 'playlists';

/** What a server's public info says about it. */
export interface ServerInfo extends Branding {
  /** Where the account behind this server is configured. */
  configureUrl: string | null;
  pinSignIn: boolean;
  /** A user's own sign-in address, which signs in that user alone. */
  personal: boolean;
  /** Each extension it implements, with its version. */
  features: Partial<Record<Feature, number>>;
  /** Sends no extensions at all, as stock Jellyfin, which has its whole API. */
  stock: boolean;
  /** The server's build, like `v2.35.0` or `nightly a1b2c3d4`. */
  version: string | null;
  /** CSS for everyone on the server, under each person's own. */
  css: string | null;
  /** Who its party relay admits besides its users, and the relay it suggests for the rest. */
  parties: { relay: PartyRelayMode; defaultRelay: string | null } | null;
  /** Whether the server keeps reports from the apps, and can pass them on to the developer. */
  reports: { forward: boolean } | null;
}

export const NO_SERVER_INFO: ServerInfo = {
  name: null,
  logo: null,
  configureUrl: null,
  pinSignIn: false,
  personal: false,
  features: {},
  stock: false,
  version: null,
  css: null,
  parties: null,
  reports: null,
};

interface PublicSystemInfo {
  ServerName?: string;
  aiostreams?: {
    logo?: string | null;
    configureUrl?: string | null;
    pinSignIn?: boolean;
    personal?: boolean;
    features?: ServerInfo['features'];
    css?: string | null;
    parties?: ServerInfo['parties'];
    reports?: ServerInfo['reports'];
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
  const query = useQuery({
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
        stock: !data.aiostreams,
        version: buildVersion(data.aiostreams?.version),
        css: data.aiostreams?.css || null,
        parties: data.aiostreams?.parties ?? null,
        reports: data.aiostreams?.reports ?? null,
      };
    },
    staleTime: 5 * 60_000,
    // A new token asks again; the screen fading out meanwhile must not change.
    placeholderData: keepPreviousData,
  });
  // While rendering, so the screens below have it for their first requests.
  allowHints(client.base, !!query.data?.features.clientHints);
  return query;
}
