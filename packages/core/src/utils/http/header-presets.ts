import { randomBytes } from 'node:crypto';

/**
 * Built-in client presets, referenced as `{name}` from the hostname/context
 * user-agent overrides (`hostnameUserAgentOverrides`).
 *
 * Each is the client's whole HTTP/1.1 header list in its order, Host and
 * Connection included. Its name is the aiostreams-impersonate profile.
 */
type PresetValue = string | ((url: URL) => string);

const host = (url: URL) => url.host;

/** W3C trace context, which .NET adds to every request. */
const traceparent = () =>
  `00-${randomBytes(16).toString('hex')}-${randomBytes(8).toString('hex')}-00`;

export const HEADER_PRESETS = {
  sabnzbd: {
    Host: host,
    'User-Agent': 'SABnzbd/5.1.3',
    'Accept-Encoding': 'gzip',
    Connection: 'close',
  },
  nzbget: {
    'User-Agent': 'nzbget/26.3',
    Host: host,
    Accept: '*/*',
    'Accept-Encoding': 'gzip',
    Connection: 'close',
  },
  sonarr: {
    Host: host,
    'User-Agent': 'Sonarr/4.0.20.3014 (alpine 3.24.4)',
    Accept: 'application/rss+xml, text/rss+xml, application/xml, text/xml',
    'Accept-Encoding': 'gzip, br',
    traceparent,
  },
  radarr: {
    Host: host,
    'User-Agent': 'Radarr/7.0.3.10918 (alpine 3.24.4)',
    Accept: 'application/rss+xml, text/rss+xml, application/xml, text/xml',
    'Accept-Encoding': 'gzip, br',
    traceparent,
  },
  prowlarr: {
    Host: host,
    'User-Agent': 'Prowlarr/2.7.0.5723 (alpine 3.24.4)',
    Accept: 'application/rss+xml, text/rss+xml, application/xml, text/xml',
    'Accept-Encoding': 'gzip, br',
    traceparent,
  },
  nzbhydra2: {
    Accept: 'application/xml',
    'User-Agent': 'NZBHydra2 9.3.1',
    'Content-Type': 'application/xml',
    Host: host,
    Connection: 'Keep-Alive',
    'Accept-Encoding': 'gzip',
  },
  vlc: {
    'User-Agent': 'VLC/3.0.21 LibVLC/3.0.21',
  },
  chrome: {
    Host: host,
    Connection: 'keep-alive',
    'sec-ch-ua':
      '"Chromium";v="158", "Not.A/Brand";v="24", "Google Chrome";v="158"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"macOS"',
    'Upgrade-Insecure-Requests': '1',
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Safari/537.36',
    Accept:
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/jxl,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-User': '?1',
    'Sec-Fetch-Dest': 'document',
    'Accept-Encoding': 'gzip, deflate, br, zstd',
    'Accept-Language': 'en-US,en;q=0.9',
  },
} satisfies Record<string, Record<string, PresetValue>>;

/** Names of the built-in header presets (for docs / UI hints). */
export const HEADER_PRESET_NAMES = Object.keys(HEADER_PRESETS);

export function presetFor(
  name: string,
  url: URL
): { name: string; headers: Record<string, string> } | undefined {
  const preset = (
    HEADER_PRESETS as Record<string, Record<string, PresetValue>>
  )[name];
  if (!preset) return undefined;
  const headers: Record<string, string> = {};
  for (const [header, item] of Object.entries(preset)) {
    headers[header] = typeof item === 'function' ? item(url) : item;
  }
  return { name, headers };
}

/** If `value` is exactly a preset reference (`{name}` for a known preset). */
export function resolveHeaderPreset(
  value: string,
  url: URL
): { name: string; headers: Record<string, string> } | undefined {
  const match = value.trim().match(/^\{([a-zA-Z0-9_-]+)\}$/);
  return match ? presetFor(match[1].toLowerCase(), url) : undefined;
}
