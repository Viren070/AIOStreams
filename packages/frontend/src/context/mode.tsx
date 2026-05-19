import React from 'react';

export type Mode = 'pro' | 'noob';

interface ModeContextType {
  mode: Mode;
  setMode: (mode: Mode) => void;
  isFirstTime: boolean;
  setIsFirstTime: (isFirstTime: boolean) => void;
}

const ModeContext = React.createContext<ModeContextType | undefined>(undefined);

const MODE_STORAGE_KEY = 'aiostreams-mode';
const FIRST_TIME_KEY = 'aiostreams-first-time';

export function ModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = React.useState<Mode>(() => {
    if (typeof window !== 'undefined') {
      const savedMode = localStorage.getItem(MODE_STORAGE_KEY);
      return (savedMode as Mode) || 'noob';
    }
    return 'noob';
  });

  const [isFirstTime, setIsFirstTimeState] = React.useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem(FIRST_TIME_KEY) === null;
    }
    return true;
  });

  const setMode = React.useCallback((newMode: Mode) => {
    setModeState(newMode);
    if (typeof window !== 'undefined') {
      localStorage.setItem(MODE_STORAGE_KEY, newMode);
    }
  }, []);

  const setIsFirstTime = React.useCallback((value: boolean) => {
    setIsFirstTimeState(value);
    if (typeof window !== 'undefined' && !value) {
      localStorage.setItem(FIRST_TIME_KEY, 'false');
    }
  }, []);

  return (
    <ModeContext.Provider
      value={{
        mode,
        setMode,
        isFirstTime,
        setIsFirstTime,
      }}
    >
      {children}
    </ModeContext.Provider>
  );
}

export function useMode() {
  const context = React.useContext(ModeContext);
  if (context === undefined) {
    throw new Error('useMode must be used within a ModeProvider');
  }
  return context;
}
