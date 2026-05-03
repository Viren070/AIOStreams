'use client';

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
} from 'react';
import { useMode } from './mode';
import { MENU_IDS, type MenuId } from '../../../core/src/utils/fieldMeta';
import { useOptions } from './options';

const VALID_MENUS = MENU_IDS;

const PRO_ONLY_MENUS: MenuId[] = ['sorting'];

export type { MenuId };

type MenuContextType = {
  selectedMenu: MenuId;
  setSelectedMenu: (menu: MenuId) => void;
  nextMenu: () => void;
  previousMenu: () => void;
  firstMenu: MenuId;
  lastMenu: MenuId;
};

const MenuContext = createContext<MenuContextType>({
  selectedMenu: 'about',
  setSelectedMenu: () => {},
  nextMenu: () => {},
  previousMenu: () => {},
  firstMenu: 'about',
  lastMenu: 'save-install',
});

export function MenuProvider({ children }: { children: React.ReactNode }) {
  const { mode } = useMode();

  const { isOptionsEnabled } = useOptions();

  const menus = useMemo(() => {
    let availableMenus = VALID_MENUS as readonly MenuId[];
    if (mode === 'noob') {
      availableMenus = availableMenus.filter(
        (menu) => !PRO_ONLY_MENUS.includes(menu)
      );
    }
    if (!isOptionsEnabled) {
      availableMenus = availableMenus.filter((menu) => menu !== 'fun');
    }
    return availableMenus;
  }, [mode, isOptionsEnabled]);

  // Get initial menu from URL or default to 'about'
  const initialMenu = (() => {
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      const menu = url.searchParams.get('menu');
      if (menu && (menus as string[]).includes(menu)) {
        return menu as MenuId;
      }
    }
    return 'about';
  })();

  const [selectedMenu, setInternalSelectedMenu] = useState<MenuId>(initialMenu);

  const setSelectedMenu = (menu: MenuId) => {
    // reset scroll position
    window.scrollTo(0, 0);
    setInternalSelectedMenu(menu);
  };

  const firstMenu = menus[0];
  const lastMenu = menus[menus.length - 1];

  const nextMenu = () => {
    const currentIndex = menus.indexOf(selectedMenu);
    const nextIndex = (currentIndex + 1) % menus.length;
    setSelectedMenu(menus[nextIndex]);
  };

  const previousMenu = () => {
    const currentIndex = menus.indexOf(selectedMenu);
    const previousIndex = (currentIndex - 1 + menus.length) % menus.length;
    setSelectedMenu(menus[previousIndex]);
  };

  // Update URL when menu changes
  useEffect(() => {
    const url = new URL(window.location.href);
    // if menu is not about, add it to the url
    if (selectedMenu !== 'about') {
      url.searchParams.set('menu', selectedMenu);
    } else {
      url.searchParams.delete('menu');
    }
    window.history.replaceState({}, '', url.toString());
  }, [selectedMenu]);

  return (
    <MenuContext.Provider
      value={{
        selectedMenu,
        setSelectedMenu,
        nextMenu,
        previousMenu,
        firstMenu,
        lastMenu,
      }}
    >
      {children}
    </MenuContext.Provider>
  );
}

export const useMenu = () => useContext(MenuContext);
