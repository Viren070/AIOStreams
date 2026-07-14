import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

type DashboardCommandPaletteContextType = {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
};

const DashboardCommandPaletteContext =
  createContext<DashboardCommandPaletteContextType>({
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
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((v) => !v), []);

  // Global Ctrl/Cmd+K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setIsOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <DashboardCommandPaletteContext.Provider
      value={{ isOpen, open, close, toggle }}
    >
      {children}
    </DashboardCommandPaletteContext.Provider>
  );
}

export const useDashboardCommandPalette = () =>
  useContext(DashboardCommandPaletteContext);
