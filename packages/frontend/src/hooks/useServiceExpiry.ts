'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ServiceId } from '@aiostreams/core';
import {
  calculateDaysRemaining,
  canServiceAutoFetch,
  EXPIRY_OVERRIDE_EVENT,
  formatExpiryTitle,
  getBadgeColors,
  getCachedExpiry,
  getExpiryPreference,
  isTrackedService,
  ServiceExpirySource,
  setCachedExpiry,
} from '@/utils/service-expiry';

type Credentials = Record<string, string | undefined> | undefined;

type ExpiryStatus =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'disabled' }
  | {
      status: 'success';
      daysRemaining: number;
      expiresAt: string;
      source: ServiceExpirySource;
      updatedAt: number | null;
    }
  | { status: 'error'; error: string };

interface UseServiceExpiryOptions {
  serviceId: ServiceId;
  serviceName: string;
  credentials: Credentials;
}

interface UseServiceExpiryResult {
  status: ExpiryStatus['status'];
  daysRemaining?: number;
  expiresAt?: string;
  badgeText?: string;
  badgeColors?: { background: string; foreground: string };
  tooltip?: string;
  error?: string;
}

export function useServiceExpiry(
  options: UseServiceExpiryOptions
): UseServiceExpiryResult {
  const { serviceId, serviceName, credentials } = options;
  const isTracked = isTrackedService(serviceId);
  const credentialSignature = useMemo(
    () => JSON.stringify(credentials ?? {}),
    [credentials]
  );

  const [overrideVersion, setOverrideVersion] = useState(0);
  const [state, setState] = useState<ExpiryStatus>({ status: 'idle' });

  useEffect(() => {
    if (!isTracked) {
      setState({ status: 'idle' });
      return;
    }
    function handleOverride(event: Event) {
      const customEvent = event as CustomEvent<{ serviceId: ServiceId }>;
      if (!customEvent.detail || customEvent.detail.serviceId === serviceId) {
        setOverrideVersion((v: number) => v + 1);
      }
    }
    window.addEventListener(EXPIRY_OVERRIDE_EVENT, handleOverride);
    return () => {
      window.removeEventListener(EXPIRY_OVERRIDE_EVENT, handleOverride);
    };
  }, [isTracked, serviceId]);

  useEffect(() => {
    if (!isTracked) {
      setState({ status: 'idle' });
      return;
    }

    const preference = getExpiryPreference(serviceId);

    if (preference.mode === 'hidden') {
      setState({ status: 'disabled' });
      return;
    }

    if (preference.mode === 'manual') {
      if (!preference.date) {
        setState({
          status: 'error',
          error: 'Set a manual expiry date to show the badge.',
        });
        return;
      }
      const days = calculateDaysRemaining(preference.date);
      if (days === null) {
        setState({ status: 'error', error: 'Invalid manual expiry date.' });
        return;
      }
      setState({
        status: 'success',
        daysRemaining: days,
        expiresAt: preference.date,
        source: 'manual',
        updatedAt: preference.updatedAt ?? null,
      });
      return;
    }

    if (!canServiceAutoFetch(serviceId)) {
      setState({ status: 'disabled' });
      return;
    }

    const cached = getCachedExpiry(serviceId);
    if (cached && cached.daysRemaining !== null) {
      setState({
        status: 'success',
        daysRemaining: cached.daysRemaining,
        expiresAt: cached.expiresAt,
        source: 'cache',
        updatedAt: cached.timestamp,
      });
      return;
    }

    let cancelled = false;
    setState({ status: 'loading' });

    fetchExpiryFromProvider(serviceId, credentials)
      .then((expiresAt) => {
        if (cancelled) return;
        if (!expiresAt) {
          setState({
            status: 'error',
            error: 'No expiry information available',
          });
          return;
        }
        const days = calculateDaysRemaining(expiresAt);
        if (days === null) {
          setState({
            status: 'error',
            error: 'Unable to parse expiry date',
          });
          return;
        }
        setCachedExpiry(serviceId, expiresAt);
        setState({
          status: 'success',
          daysRemaining: days,
          expiresAt,
          source: 'api',
          updatedAt: Date.now(),
        });
      })
      .catch((error) => {
        if (cancelled) return;
        const message =
          error instanceof Error ? error.message : 'Failed to fetch expiry';
        setState({ status: 'error', error: message });
      });

    return () => {
      cancelled = true;
    };
  }, [credentialSignature, isTracked, overrideVersion, serviceId, serviceName]);

  if (state.status !== 'success') {
    if (state.status === 'disabled') {
      return { status: 'disabled' };
    }
    if (state.status === 'error') {
      return { status: 'error', error: state.error };
    }
    return { status: state.status };
  }

  const badgeColors = getBadgeColors(state.daysRemaining);
  const badgeText =
    state.daysRemaining > 0 ? `${state.daysRemaining} DAYS` : 'EXPIRED';
  const tooltip = formatExpiryTitle({
    serviceName,
    expiresAt: state.expiresAt,
    source: state.source,
    updatedAt: state.updatedAt,
  });

  return {
    status: 'success',
    daysRemaining: state.daysRemaining,
    expiresAt: state.expiresAt,
    badgeColors,
    badgeText,
    tooltip,
  };
}

async function fetchExpiryFromProvider(
  serviceId: ServiceId,
  credentials: Credentials
): Promise<string | null> {
  switch (serviceId) {
    case 'realdebrid':
      return fetchRealDebridExpiry(credentials);
    case 'alldebrid':
      return fetchAllDebridExpiry(credentials);
    case 'premiumize':
      return fetchPremiumizeExpiry(credentials);
    case 'debridlink':
      return fetchDebridLinkExpiry(credentials);
    case 'torbox':
      return fetchTorBoxExpiry(credentials);
    default:
      return null;
  }
}

async function fetchRealDebridExpiry(
  credentials: Credentials
): Promise<string | null> {
  const apiKey = credentials?.apiKey?.trim();
  if (!apiKey) {
    throw new Error('Enter your Real-Debrid API key to view expiry.');
  }
  const response = await fetch('https://api.real-debrid.com/rest/1.0/user', {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`Real-Debrid API error (${response.status})`);
  }
  const data: { expiration?: string } = await response.json();
  return data.expiration ?? null;
}

async function fetchAllDebridExpiry(
  credentials: Credentials
): Promise<string | null> {
  const apiKey = credentials?.apiKey?.trim();
  if (!apiKey) {
    throw new Error('Enter your AllDebrid API key to view expiry.');
  }
  const response = await fetch('https://api.alldebrid.com/v4/user', {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`AllDebrid API error (${response.status})`);
  }
  const data = await response.json();
  if (data?.status !== 'success' || !data?.data?.user) {
    throw new Error('AllDebrid API returned an unexpected response.');
  }
  const user = data.data.user as {
    premiumUntil?: number | string;
    premium_until?: number | string;
    premiumUntilIso?: string;
    premium_until_iso?: string;
  };
  if (typeof user?.premiumUntilIso === 'string' && user.premiumUntilIso) {
    return user.premiumUntilIso;
  }
  if (typeof user?.premium_until_iso === 'string' && user.premium_until_iso) {
    return user.premium_until_iso;
  }
  const secondsRaw = Number(user?.premiumUntil ?? user?.premium_until ?? 0);
  if (Number.isFinite(secondsRaw) && secondsRaw > 0) {
    const millis =
      secondsRaw > 1_000_000_000_000 ? secondsRaw : secondsRaw * 1000;
    return new Date(millis).toISOString();
  }
  const fallbackDate = (user?.premiumUntil ?? user?.premium_until) as
    | string
    | undefined;
  if (typeof fallbackDate === 'string' && fallbackDate) {
    const parsed = new Date(fallbackDate);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  return null;
}

async function fetchPremiumizeExpiry(
  credentials: Credentials
): Promise<string | null> {
  const apiKey = credentials?.apiKey?.trim();
  if (!apiKey) {
    throw new Error('Enter your Premiumize API key to view expiry.');
  }
  const url = new URL('https://www.premiumize.me/api/account/info');
  url.searchParams.set('apikey', apiKey);
  const response = await fetch(url.toString(), {
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`Premiumize API error (${response.status})`);
  }
  const data = await response.json();
  if (String(data?.status).toLowerCase() !== 'success') {
    throw new Error('Premiumize API returned an unexpected response.');
  }
  const expires = Number(data?.premium_until ?? data?.premiumUntil ?? 0);
  if (Number.isFinite(expires) && expires > 0) {
    const millis = expires > 1_000_000_000_000 ? expires : expires * 1000;
    return new Date(millis).toISOString();
  }
  const rawExpiry = (data?.premium_until ?? data?.premiumUntil) as
    | string
    | undefined;
  if (typeof rawExpiry === 'string' && rawExpiry) {
    const parsed = new Date(rawExpiry);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  return null;
}

async function fetchDebridLinkExpiry(
  credentials: Credentials
): Promise<string | null> {
  const apiKey = credentials?.apiKey?.trim();
  if (!apiKey) {
    throw new Error('Enter your Debrid-Link API key to view expiry.');
  }
  const response = await fetch('https://debrid-link.com/api/account/infos', {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`Debrid-Link API error (${response.status})`);
  }
  const data = await response.json();
  if (!data?.success || !data?.value) {
    throw new Error('Debrid-Link API returned an unexpected response.');
  }
  const value = data.value as {
    premiumLeft?: number | string;
    premium_left?: number | string;
    premiumUntilIso?: string;
    premium_until_iso?: string;
    premiumUntil?: string;
  };
  if (typeof value?.premiumUntilIso === 'string' && value.premiumUntilIso) {
    return value.premiumUntilIso;
  }
  if (typeof value?.premium_until_iso === 'string' && value.premium_until_iso) {
    return value.premium_until_iso;
  }
  if (typeof value?.premiumUntil === 'string' && value.premiumUntil) {
    const parsed = new Date(value.premiumUntil);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  const secondsRaw = Number(value?.premiumLeft ?? value?.premium_left ?? 0);
  if (Number.isFinite(secondsRaw) && secondsRaw > 0) {
    return new Date(Date.now() + secondsRaw * 1000).toISOString();
  }
  return null;
}

async function fetchTorBoxExpiry(
  credentials: Credentials
): Promise<string | null> {
  const apiKey = credentials?.apiKey?.trim();
  if (!apiKey) {
    throw new Error('Enter your TorBox API key to view expiry.');
  }
  const response = await fetch(
    'https://api.torbox.app/v1/api/user/me?settings=true',
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      cache: 'no-store',
    }
  );
  if (!response.ok) {
    throw new Error(`TorBox API error (${response.status})`);
  }
  const json = await response.json();
  const data = json?.data ?? json;
  const expiresAt =
    data?.premium_expires_at ||
    data?.premium_until_iso ||
    data?.premiumUntilIso ||
    data?.premiumExpiresAt;
  return typeof expiresAt === 'string' && expiresAt.length > 0
    ? expiresAt
    : null;
}