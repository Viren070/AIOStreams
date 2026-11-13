import React from 'react';
import { useRouterState } from '@tanstack/react-router';
import { navigate } from '@/lib/paths';

/** Kept in the address, so going back to the page brings the choice back. */
export function useSearchParam(
  name: string
): [string | undefined, (next: string | undefined) => void] {
  const value = useRouterState({
    select: (s) =>
      new URLSearchParams(s.location.searchStr).get(name) ?? undefined,
  });
  const set = React.useCallback(
    (next: string | undefined) => {
      const [path, query = ''] = location.hash.slice(1).split('?');
      const params = new URLSearchParams(query);
      if (next === undefined) params.delete(name);
      else params.set(name, next);
      const search = params.toString();
      navigate(search ? `${path}?${search}` : path, {
        replace: true,
        keepScroll: true,
      });
    },
    [name]
  );
  return [value, set];
}
