import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { logout as apiLogout, SessionUser } from '@/lib/api';
import { sessionQuery } from '@/lib/queries';

export type { SessionUser };

export function useSession() {
  const qc = useQueryClient();
  const { data: user, isLoading: loading } = useQuery(sessionQuery);

  const refresh = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: sessionQuery.queryKey });
  }, [qc]);

  const { mutateAsync: signOutMutate } = useMutation({
    mutationFn: apiLogout,
    onSettled: () => {
      qc.removeQueries({ queryKey: sessionQuery.queryKey });
    },
  });

  const signOut = useCallback(async () => {
    await signOutMutate();
  }, [signOutMutate]);

  return {
    user: user ?? null,
    loading,
    refresh,
    signOut,
  };
}
