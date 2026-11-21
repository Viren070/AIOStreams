import React, { createContext, useCallback, useContext } from 'react';
import { useMenu } from './menu';
import { useSubTabContext } from './sub-tab';
import type { MenuId } from '../../../core/src/utils/fieldMeta';
import { useCommandPaletteState } from '@/components/shared/command-palette/state';
import { scrollAndHighlight } from '@/components/shared/command-palette/scroll-highlight';

export type NavigateTarget = {
  menu: MenuId;
  /** Sub-tab within the destination menu, if it has tabs. */
  subTab?: string;
  field?: string;
  /** Preferred scroll target id, then fallbacks (the first that exists wins). */
  sectionId?: string;
  fallbackSectionIds?: string[];
};

type CommandPaletteContextType = {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  navigate: (target: NavigateTarget) => void;
};

const CommandPaletteContext = createContext<CommandPaletteContextType>({
  isOpen: false,
  open: () => {},
  close: () => {},
  toggle: () => {},
  navigate: () => {},
});

export function CommandPaletteProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isOpen, open, close, toggle } = useCommandPaletteState();
  const { openMenu, layout } = useMenu();
  const { setSubTab } = useSubTabContext();

  const navigate = useCallback(
    (target: NavigateTarget) => {
      // Always update the sub-tab first so the destination renders the right
      // tab content immediately, regardless of whether we are switching menus.
      // The new layout keeps it in the address it opens instead.
      if (target.subTab && layout === 'classic') {
        setSubTab(target.menu, target.subTab);
      }
      openMenu(target.menu, target.subTab, target.field);
      close();
      const ids = [
        target.sectionId,
        ...(target.fallbackSectionIds ?? []),
      ].filter((v): v is string => Boolean(v));
      if (ids.length > 0) {
        scrollAndHighlight(ids);
      }
    },
    [openMenu, setSubTab, close, layout]
  );

  return (
    <CommandPaletteContext.Provider
      value={{ isOpen, open, close, toggle, navigate }}
    >
      {children}
    </CommandPaletteContext.Provider>
  );
}

export const useCommandPalette = () => useContext(CommandPaletteContext);
