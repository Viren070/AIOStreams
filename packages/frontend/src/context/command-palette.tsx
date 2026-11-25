import React, { createContext, useCallback, useContext } from 'react';
import { useMenu } from './menu';
import type { PageId } from '@/lib/configure-pages';
import { useCommandPaletteState } from '@/components/shared/command-palette/state';
import { scrollAndHighlight } from '@/components/shared/command-palette/scroll-highlight';

export type NavigateTarget = {
  page: PageId;
  tab?: string;
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
  const { setPage } = useMenu();

  const navigate = useCallback(
    (target: NavigateTarget) => {
      setPage(target.page, target.tab);
      close();
      const ids = [
        target.sectionId,
        ...(target.fallbackSectionIds ?? []),
      ].filter((v): v is string => Boolean(v));
      if (ids.length > 0) {
        scrollAndHighlight(ids);
      }
    },
    [setPage, close]
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
