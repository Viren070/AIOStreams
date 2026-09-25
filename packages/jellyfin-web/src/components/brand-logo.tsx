import React from 'react';
import { useQuery } from '@tanstack/react-query';
import type { JellyfinClient } from '../lib/client';
import type { Branding } from '../lib/types';

const NONE: Branding = { name: null, logo: null };
const BrandingContext = React.createContext<Branding>(NONE);
export const BrandingProvider = BrandingContext.Provider;

export function useBranding(): Branding {
  return React.useContext(BrandingContext);
}

/** The configuration's name and logo, as the public server info gives them. */
export function useServerBranding(
  client: JellyfinClient,
  override?: Branding
): Branding {
  const info = useQuery({
    queryKey: ['jf-branding', client.base, client.token],
    queryFn: async (): Promise<Branding> => {
      const data = await client.get<{
        ServerName?: string;
        aiostreams?: { logo?: string | null };
      }>('/System/Info/Public');
      return {
        name: data.ServerName ?? null,
        logo: data.aiostreams?.logo ?? null,
        aiostreams: !!data.aiostreams,
      };
    },
    enabled: !override,
    staleTime: 5 * 60_000,
  });
  return override ?? info.data ?? NONE;
}

/** The configuration's logo, or the product's when it has none or it fails. */
export function BrandLogo({ className }: { className?: string }) {
  const { name, logo } = React.useContext(BrandingContext);
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => setFailed(false), [logo]);
  return (
    <img
      src={logo && !failed ? logo : '/logo.png'}
      alt={name ?? 'AIOStreams'}
      onError={() => setFailed(true)}
      className={className}
    />
  );
}
