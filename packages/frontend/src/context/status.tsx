'use client';
import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from 'react';
import { StatusResponse } from '@aiostreams/core';
import { api } from '@/lib/api';

type StatusContextType = {
  status: StatusResponse | null;
  loading: boolean;
  error: string | null;
};

const StatusContext = createContext<StatusContextType>({
  status: null,
  loading: true,
  error: null,
});

export const useStatus = () => useContext(StatusContext);

export function StatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<StatusResponse>('/status')
      .then((data) => setStatus(data))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <StatusContext.Provider value={{ status, loading, error }}>
      {children}
    </StatusContext.Provider>
  );
}
