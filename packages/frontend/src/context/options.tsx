import React, { createContext, useContext, useState } from 'react';

interface OptionsContextType {
  isOptionsEnabled: boolean;
  toggleOptions: () => void;
}

const OptionsContext = createContext<OptionsContextType | undefined>(undefined);

export function OptionsProvider({ children }: { children: React.ReactNode }) {
  const [isOptionsEnabled, setIsOptionsEnabled] = useState(false);

  const toggleOptions = () => {
    setIsOptionsEnabled((prev) => !prev);
  };

  return (
    <OptionsContext.Provider value={{ isOptionsEnabled, toggleOptions }}>
      {children}
    </OptionsContext.Provider>
  );
}

export function useOptions() {
  const context = useContext(OptionsContext);
  if (context === undefined) {
    throw new Error('useOptions must be used within a OptionsProvider');
  }
  return context;
}
