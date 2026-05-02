'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

export type QuickAction = {
  id: string;
  label: string;
  description?: string;
  icon?: React.ReactNode;
  /** Optional keyboard hint for display */
  shortcut?: string;
  /** Search keywords */
  keywords?: string[];
  onSelect: () => void;
};

type QuickActionsContextType = {
  actions: QuickAction[];
  register: (action: QuickAction) => () => void;
};

const QuickActionsContext = createContext<QuickActionsContextType>({
  actions: [],
  register: () => () => {},
});

export function QuickActionsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [, force] = useState(0);
  const actionsRef = useRef<Map<string, QuickAction>>(new Map());

  const register = useCallback((action: QuickAction) => {
    actionsRef.current.set(action.id, action);
    force((n) => n + 1);
    return () => {
      actionsRef.current.delete(action.id);
      force((n) => n + 1);
    };
  }, []);

  const value = useMemo<QuickActionsContextType>(
    () => ({
      actions: Array.from(actionsRef.current.values()),
      register,
    }),
    // Recreate whenever the registry changes (force tick is the trigger)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [register, actionsRef.current.size, ...Array.from(actionsRef.current.keys())]
  );

  return (
    <QuickActionsContext.Provider value={value}>
      {children}
    </QuickActionsContext.Provider>
  );
}

export const useQuickActions = () => useContext(QuickActionsContext);

/** Convenience hook to register a quick action while a component is mounted. */
export function useRegisterQuickAction(
  action: QuickAction | null,
  deps: React.DependencyList
) {
  const { register } = useQuickActions();
  useEffect(() => {
    if (!action) return;
    return register(action);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
