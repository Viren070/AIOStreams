'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { MenuId } from '../../../core/src/utils/fieldMeta';

/**
 * Per-menu URL query parameter used to persist the active sub-tab. Keep this
 * in sync with the menu pages that read/write the URL (search the codebase
 * for `searchParams.get('filter')` etc.).
 */
const URL_KEY_BY_MENU: Partial<Record<MenuId, string>> = {
  filters: 'filter',
  miscellaneous: 'misc-tab',
  services: 'service-tab',
  addons: 'addons-tab',
};

const DEFAULT_TAB_BY_MENU: Partial<Record<MenuId, string>> = {
  filters: 'cache',
  miscellaneous: 'background',
  services: 'services',
  addons: 'addons',
};

type SubTabContextType = {
  /** Current active sub-tab keyed by menu id. */
  subTabs: Partial<Record<MenuId, string>>;
  setSubTab: (menu: MenuId, tab: string) => void;
  getUrlKey: (menu: MenuId) => string | undefined;
};

const SubTabContext = createContext<SubTabContextType>({
  subTabs: {},
  setSubTab: () => {},
  getUrlKey: () => undefined,
});

function readInitial(): Partial<Record<MenuId, string>> {
  const result: Partial<Record<MenuId, string>> = { ...DEFAULT_TAB_BY_MENU };
  if (typeof window === 'undefined') return result;
  const url = new URL(window.location.href);
  for (const [menu, key] of Object.entries(URL_KEY_BY_MENU) as Array<
    [MenuId, string]
  >) {
    const value = url.searchParams.get(key);
    if (value) result[menu] = value;
  }
  return result;
}

export function SubTabProvider({ children }: { children: React.ReactNode }) {
  const [subTabs, setSubTabs] = useState<Partial<Record<MenuId, string>>>(
    readInitial
  );

  const setSubTab = useCallback((menu: MenuId, tab: string) => {
    setSubTabs((prev) => ({ ...prev, [menu]: tab }));
    if (typeof window !== 'undefined') {
      const key = URL_KEY_BY_MENU[menu];
      if (key) {
        const url = new URL(window.location.href);
        url.searchParams.set(key, tab);
        window.history.replaceState({}, '', url.toString());
      }
    }
  }, []);

  const getUrlKey = useCallback(
    (menu: MenuId) => URL_KEY_BY_MENU[menu],
    []
  );

  // Re-sync from URL on popstate (back/forward navigation).
  useEffect(() => {
    const sync = () => setSubTabs(readInitial());
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);

  const value = useMemo<SubTabContextType>(
    () => ({ subTabs, setSubTab, getUrlKey }),
    [subTabs, setSubTab, getUrlKey]
  );

  return (
    <SubTabContext.Provider value={value}>{children}</SubTabContext.Provider>
  );
}

export function useSubTab(menu: MenuId) {
  const ctx = useContext(SubTabContext);
  const tab = ctx.subTabs[menu] ?? DEFAULT_TAB_BY_MENU[menu] ?? '';
  const setTab = useCallback(
    (next: string) => ctx.setSubTab(menu, next),
    [ctx, menu]
  );
  return { tab, setTab };
}

export const useSubTabContext = () => useContext(SubTabContext);
