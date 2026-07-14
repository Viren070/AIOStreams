import React, { createContext, useContext } from 'react';
import {
  useCommandPaletteState,
  type CommandPaletteState,
} from '@/components/shared/command-palette/state';

const DashboardCommandPaletteContext = createContext<CommandPaletteState>({
  isOpen: false,
  open: () => {},
  close: () => {},
  toggle: () => {},
});

export function DashboardCommandPaletteProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const state = useCommandPaletteState();
  return (
    <DashboardCommandPaletteContext.Provider value={state}>
      {children}
    </DashboardCommandPaletteContext.Provider>
  );
}

export const useDashboardCommandPalette = () =>
  useContext(DashboardCommandPaletteContext);
