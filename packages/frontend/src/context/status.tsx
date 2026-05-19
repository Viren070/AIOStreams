import { useQuery } from '@tanstack/react-query';
import { StatusResponse } from '@aiostreams/core';
import { statusQuery } from '@/lib/queries';

export type { StatusResponse };

type StatusResult = {
  status: StatusResponse | null;
  loading: boolean;
  error: string | null;
};

export function useStatus(): StatusResult {
  const { data, isLoading, error } = useQuery(statusQuery);
  return {
    status: data ?? null,
    loading: isLoading,
    error: error ? (error as Error).message : null,
  };
}
