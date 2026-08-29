import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type {
  CommunityBlock,
  CommunityItem,
  CommunityKind,
  CommunityStatus,
} from '@aiostreams/core';
import { api } from '@/lib/api';

const ROOT = ['dashboard', 'community'] as const;

export interface CommunityItemsParams {
  kind?: CommunityKind;
  status?: CommunityStatus;
  search?: string;
  pending?: boolean;
  limit?: number;
  offset?: number;
}

export function useCommunityItems(params: CommunityItemsParams) {
  const qs = new URLSearchParams();
  if (params.kind) qs.set('kind', params.kind);
  if (params.status) qs.set('status', params.status);
  if (params.search) qs.set('search', params.search);
  if (params.pending) qs.set('pending', '1');
  if (params.limit !== undefined) qs.set('limit', String(params.limit));
  if (params.offset !== undefined) qs.set('offset', String(params.offset));
  const query = qs.toString();
  return useQuery({
    queryKey: [...ROOT, 'items', query] as const,
    queryFn: () =>
      api<{ entries: CommunityItem[]; total: number }>(
        `/dashboard/community/items${query ? `?${query}` : ''}`
      ),
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  });
}

export function useCommunityBlocks() {
  return useQuery({
    queryKey: [...ROOT, 'blocks'] as const,
    queryFn: () =>
      api<{ blocks: CommunityBlock[] }>('/dashboard/community/blocks'),
    staleTime: 10_000,
  });
}

function useInvalidating<TInput, TOutput>(
  fn: (input: TInput) => Promise<TOutput>
) {
  const qc = useQueryClient();
  return useMutation<TOutput, Error, TInput>({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ROOT });
      // The public lists on the configure page share the same cache.
      qc.invalidateQueries({ queryKey: ['community'] });
    },
  });
}

const item = (id: string): `/${string}` =>
  `/dashboard/community/items/${encodeURIComponent(id)}`;

export function useApproveItem() {
  return useInvalidating(({ id, trusted }: { id: string; trusted?: boolean }) =>
    api(`POST ${item(id)}/approve`, { body: { trusted } })
  );
}

export function useRejectItem() {
  return useInvalidating(({ id, reason }: { id: string; reason: string }) =>
    api(`POST ${item(id)}/reject`, { body: { reason } })
  );
}

export function useApproveDraft() {
  return useInvalidating((id: string) => api(`POST ${item(id)}/draft/approve`));
}

export function useRejectDraft() {
  return useInvalidating(({ id, reason }: { id: string; reason: string }) =>
    api(`POST ${item(id)}/draft/reject`, { body: { reason } })
  );
}

export function useDeleteItem() {
  return useInvalidating((id: string) => api(`DELETE ${item(id)}`));
}

export function useSetTrusted() {
  return useInvalidating(({ id, trusted }: { id: string; trusted: boolean }) =>
    api(`POST ${item(id)}/trusted`, { body: { trusted } })
  );
}

export function useResetLikes() {
  return useInvalidating((id: string) => api(`POST ${item(id)}/reset-likes`));
}

export function useAddBlock() {
  return useInvalidating(
    (input: { itemId: string; kind: 'owner' | 'ip'; reason?: string }) =>
      api('POST /dashboard/community/blocks', { body: input })
  );
}

export interface RemoteSourceState {
  url: string;
  lastFetchedAt?: number;
  count: number;
  error?: string;
}

export function useCommunityRemote() {
  return useQuery({
    queryKey: [...ROOT, 'remote'] as const,
    queryFn: () =>
      api<{ sources: RemoteSourceState[] }>('/dashboard/community/remote'),
    staleTime: 10_000,
  });
}

export function useRemoveBlock() {
  return useInvalidating((hash: string) =>
    api(`DELETE /dashboard/community/blocks/${encodeURIComponent(hash)}`)
  );
}
