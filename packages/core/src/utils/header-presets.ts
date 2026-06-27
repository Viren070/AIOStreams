/**
 * Built-in request-header presets. Referenced from the hostname/context
 * user-agent overrides (`hostnameUserAgentOverrides`) via the `{name}` syntax,
 * e.g. `[nzb_grabs]:{sabnzbd}` to send SABnzbd's headers for every NZB grab.
 */
export const HEADER_PRESETS: Record<string, Record<string, string>> = {
  sabnzbd: {
    'User-Agent': 'SABnzbd/5.0.4',
  },
  nzbget: {
    Accept: '*/*',
    'User-Agent': 'nzbget/26.1',
  },
  sonarr: {
    Accept: 'application/rss+xml, text/rss+xml, application/xml, text/xml',
    'User-Agent': 'Sonarr/4.0.17.2952 (alpine 3.23.4)',
  },
  radarr: {
    Accept: 'application/rss+xml, text/rss+xml, application/xml, text/xml',
    'User-Agent': 'Radarr/6.2.1.10461 (alpine 3.23.4)',
  },
  prowlarr: {
    Accept: 'application/rss+xml, text/rss+xml, application/xml, text/xml',
    'User-Agent': 'Prowlarr/2.4.0.5397 (alpine 3.23.4)',
  },
  nzbhydra2: {
    Accept: 'application/xml',
    'User-Agent': 'NZBHydra2 8.8.3',
  },
  chrome: {
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
    Accept:
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': 'en-US,en;q=0.9',
    Priority: 'u=0, i',
    'Sec-Ch-Ua':
      '"Google Chrome";v="143", "Chromium";v="143", "Not A(Brand";v="24"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"macOS"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-site',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
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
