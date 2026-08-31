import type { Credentials } from '@/lib/api';
import { queryOptions } from '@tanstack/react-query';
import {
  getSession,
  listConfigProfiles,
  fetchLinkedAccounts,
  fetchLinkedAccountPlatforms,
  fetchCommunityItems,
  fetchMyCommunityItems,
  api,
  type LinkedAccount,
  type LinkedAccountPlatformInfo,
} from './api';
import type {
  CommunityItemMine,
  CommunityItemPublic,
  CommunityKind,
  StatusResponse,
} from '@aiostreams/core';

export const sessionQuery = queryOptions({
  queryKey: ['session'] as const,
  queryFn: getSession,
  staleTime: 60_000,
  retry: false,
});

export const statusQuery = queryOptions({
  queryKey: ['status'] as const,
  queryFn: () => api<StatusResponse>('/status'),
  staleTime: 60_000,
  retry: false,
});

// 401s without a session, which is a normal state on the configure page.
export const configProfilesQuery = queryOptions({
  queryKey: ['config-profiles'] as const,
  queryFn: listConfigProfiles,
  staleTime: 30_000,
  retry: false,
});

/**
 * Shared so the install card and the save flow cannot disagree about what is
 * linked. The password is deliberately not part of the key.
 */
export const linkedAccountsQuery = (
  credentials: { uuid: string; password: string | null } | null
) =>
  queryOptions({
    queryKey: ['linked-accounts', credentials?.uuid ?? null] as const,
    queryFn: (): Promise<LinkedAccount[]> =>
      credentials ? fetchLinkedAccounts(credentials) : Promise.resolve([]),
    enabled: !!credentials,
    staleTime: 30_000,
    retry: false,
  });

export const LINKED_ACCOUNTS_QUERY_ROOT = ['linked-accounts'] as const;

/** Descriptors are static per instance, so they are cached for the session. */
export const linkedAccountPlatformsQuery = (credentials: Credentials | null) =>
  queryOptions({
    queryKey: ['linked-account-platforms'] as const,
    queryFn: (): Promise<LinkedAccountPlatformInfo[]> =>
      credentials
        ? fetchLinkedAccountPlatforms(credentials)
        : Promise.resolve([]),
    enabled: !!credentials,
    staleTime: Infinity,
    retry: false,
  });

export const COMMUNITY_QUERY_ROOT = ['community'] as const;
export const MY_COMMUNITY_QUERY_ROOT = ['community-mine'] as const;

export const communityItemsQuery = (kind: CommunityKind) =>
  queryOptions({
    queryKey: [...COMMUNITY_QUERY_ROOT, kind] as const,
    queryFn: (): Promise<CommunityItemPublic[]> => fetchCommunityItems(kind),
    staleTime: 60_000,
    retry: false,
  });

/** The password is deliberately not part of the key. */
export const myCommunityQuery = (credentials: Credentials | null) =>
  queryOptions({
    queryKey: [...MY_COMMUNITY_QUERY_ROOT, credentials?.uuid ?? null] as const,
    queryFn: (): Promise<CommunityItemMine[]> =>
      credentials ? fetchMyCommunityItems(credentials) : Promise.resolve([]),
    enabled: !!credentials,
    staleTime: 15_000,
    retry: false,
  });
