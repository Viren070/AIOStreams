import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export type Range = '24h' | '7d' | '30d' | 'all';

export interface Overview {
  totalUsers: number;
  newUsers: { d1: number; d7: number; d30: number };
  activeUsers: { d1: number; d7: number };
  requests24h: number;
}
export interface GrowthPoint {
  day: string;
  new: number;
  total: number;
}
export interface RequestsData {
  resources: string[];
  series: Array<Record<string, number | string>>;
}
export interface AddonRow {
  presetId: string;
  requests: number;
  share: number;
  errors: number;
  errorRate: number;
  errorKinds: Record<string, number>;
  avgLatencyMs: number | null;
}
export interface AddonsData {
  total: number;
  customEndpoints: number;
  addons: AddonRow[];
}

export const useOverview = () =>
  useQuery({
    queryKey: ['dashboard', 'analytics', 'overview'],
    queryFn: () => api<Overview>('/dashboard/analytics/overview'),
    staleTime: 30_000,
  });

export const useUsersAnalytics = (range: Range) =>
  useQuery({
    queryKey: ['dashboard', 'analytics', 'users', range],
    queryFn: () =>
      api<{
        growth: GrowthPoint[];
        topUsers: { uuidHash: string; requests: number }[];
      }>(`/dashboard/analytics/users?range=${range}`),
    staleTime: 30_000,
  });

export const useRequestsAnalytics = (range: Range) =>
  useQuery({
    queryKey: ['dashboard', 'analytics', 'requests', range],
    queryFn: () =>
      api<RequestsData>(`/dashboard/analytics/requests?range=${range}`),
    staleTime: 30_000,
  });

export const useAddonsAnalytics = (range: Range) =>
  useQuery({
    queryKey: ['dashboard', 'analytics', 'addons', range],
    queryFn: () =>
      api<AddonsData>(`/dashboard/analytics/addons?range=${range}`),
    staleTime: 30_000,
  });

/**
 * Global feature-usage rollups: which services/formatters/presets users
 * actually configure across the instance. Each entry's `count` is the number
 * of distinct users (uuid_hashes) who had that feature on in the window.
 */
export interface FeatureEntry {
  key: string;
  count: number;
}
export interface FeaturesData {
  service: FeatureEntry[];
  formatter: FeatureEntry[];
  preset: FeatureEntry[];
  /** Per-day distinct-user count for each service. Drives the trend chart. */
  serviceSeries: Array<{ day: string; key: string; count: number }>;
}

export const useFeaturesAnalytics = (range: Range) =>
  useQuery({
    queryKey: ['dashboard', 'analytics', 'features', range],
    queryFn: () =>
      api<FeaturesData>(`/dashboard/analytics/features?range=${range}`),
    staleTime: 30_000,
  });
