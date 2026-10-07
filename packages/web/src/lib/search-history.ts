import React from 'react';
import { storage } from './storage';

const MAX_TERMS = 12;

/** The terms a user searched on this device, newest first. */
export function useSearchHistory(userId: string) {
  const key = `aiostreams-web-search-history:${userId}`;
  const [terms, setTerms] = React.useState<string[]>(
    () => storage.get<string[]>(key) ?? []
  );
  const save = (next: string[]) => {
    storage.set(key, next);
    setTerms(next);
  };
  const others = (term: string) =>
    (storage.get<string[]>(key) ?? []).filter(
      (t) => t.toLowerCase() !== term.toLowerCase()
    );
  return {
    terms,
    add: (term: string) => {
      const trimmed = term.trim();
      if (trimmed) save([trimmed, ...others(trimmed)].slice(0, MAX_TERMS));
    },
    remove: (term: string) => save(others(term)),
    clear: () => save([]),
  };
}
