import { queryOptions } from '@tanstack/react-query';
import { getSession, api } from './api';
import type { StatusResponse } from '@aiostreams/core';

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
