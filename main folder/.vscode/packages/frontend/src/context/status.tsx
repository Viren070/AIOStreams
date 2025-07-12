'use client';
import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from 'react';
import { StatusResponse } from '@aiostreams/core';

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

const baseUrl = process.env.NEXT_PUBLIC_BACKEND_BASE_URL || '/api/v1';

export function StatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${baseUrl}/status`)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch status');
        return res.json();
      })
      .then((data) => setStatus(data.data))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <StatusContext.Provider value={{ status, loading, error }}>
      {children}
    </StatusContext.Provider>
  );
}
