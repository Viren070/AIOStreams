/**
 * Built-in request-header presets. Referenced from the hostname/context
 * user-agent overrides (`hostnameUserAgentOverrides`) via the `{name}` syntax,
 * e.g. `[nzb_grabs]:{sabnzbd}` to send SABnzbd's headers for every NZB grab.
 *
 * Each preset is the client's whole header set over HTTP/1.1, in its order.
 */
export const HEADER_PRESETS: Record<string, Record<string, string>> = {
  sabnzbd: {
    'User-Agent': 'SABnzbd/5.1.3',
    'Accept-Encoding': 'gzip',
    Connection: 'close',
  },
  nzbget: {
    'User-Agent': 'nzbget/26.3',
    Accept: '*/*',
    'Accept-Encoding': 'gzip',
    Connection: 'close',
  },
  sonarr: {
    'User-Agent': 'Sonarr/4.0.20.3014 (alpine 3.24.4)',
    Accept: 'application/rss+xml, text/rss+xml, application/xml, text/xml',
    'Accept-Encoding': 'gzip, br',
  },
  radarr: {
    'User-Agent': 'Radarr/7.0.3.10918 (alpine 3.24.4)',
    Accept: 'application/rss+xml, text/rss+xml, application/xml, text/xml',
    'Accept-Encoding': 'gzip, br',
  },
  prowlarr: {
    'User-Agent': 'Prowlarr/2.7.0.5723 (alpine 3.24.4)',
    Accept: 'application/rss+xml, text/rss+xml, application/xml, text/xml',
    'Accept-Encoding': 'gzip, br',
  },
  nzbhydra2: {
    Accept: 'application/xml',
    'User-Agent': 'NZBHydra2 9.3.1',
    'Content-Type': 'application/xml',
    'Accept-Encoding': 'gzip',
  },
  chrome: {
    'sec-ch-ua':
      '"Chromium";v="158", "Not.A/Brand";v="24", "Google Chrome";v="158"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"macOS"',
    'Accept-Language': 'en-US,en;q=0.9',
    'Upgrade-Insecure-Requests': '1',
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Safari/537.36',
    Accept:
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-User': '?1',
    'Sec-Fetch-Dest': 'document',
    'Accept-Encoding': 'gzip, deflate, br, zstd',
  },
};

/** Names of the built-in header presets (for docs / UI hints). */
export const HEADER_PRESET_NAMES = Object.keys(HEADER_PRESETS);

/**
 * If `value` is exactly a preset reference (`{name}` for a known preset),
 * return a copy of its header set
 */
export function resolveHeaderPreset(
  value: string
): Record<string, string> | undefined {
  const match = value.trim().match(/^\{([a-zA-Z0-9_-]+)\}$/);
  if (!match) return undefined;
  const preset = HEADER_PRESETS[match[1].toLowerCase()];
  return preset ? { ...preset } : undefined;
}
