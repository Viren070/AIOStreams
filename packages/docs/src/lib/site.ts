/** Canonical origin. Also the `metadataBase` every relative URL resolves against. */
export const SITE_URL = 'https://docs.aiostreams.viren070.me';

/**
 * Absolute canonical URL for a route.
 */
export function canonical(path: string): string {
  return new URL(path.endsWith('/') ? path : `${path}/`, SITE_URL).href;
}

export const sharedOpenGraph = {
  type: 'website',
  siteName: 'AIOStreams',
  locale: 'en_GB',
  images: '/og/site.webp',
} as const;
