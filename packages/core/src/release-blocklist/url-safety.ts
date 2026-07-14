function parseIpv4(host: string): number | null {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = ((value << 8) | octet) >>> 0;
  }
  return value;
}

function ipv4(address: string): number {
  return parseIpv4(address)!;
}

const BLOCKED_IPV4_RANGES: Array<[number, number]> = [
  [ipv4('0.0.0.0'), 8],
  [ipv4('10.0.0.0'), 8],
  [ipv4('100.64.0.0'), 10],
  [ipv4('127.0.0.0'), 8],
  [ipv4('169.254.0.0'), 16],
  [ipv4('172.16.0.0'), 12],
  [ipv4('192.168.0.0'), 16],
];

function isBlockedIpv4Value(value: number): boolean {
  return BLOCKED_IPV4_RANGES.some(([base, prefix]) => {
    const mask = (-1 << (32 - prefix)) >>> 0;
    return (value & mask) >>> 0 === (base & mask) >>> 0;
  });
}

function isBlockedIpv4(host: string): boolean {
  const value = parseIpv4(host);
  return value !== null && isBlockedIpv4Value(value);
}

/** The URL parser serializes IPv4-mapped hosts as hex groups, e.g. `::ffff:c0a8:101`. */
function mappedIpv4Value(rest: string): number | null {
  const dotted = parseIpv4(rest);
  if (dotted !== null) return dotted;
  const groups = rest.split(':');
  if (groups.length === 2 && groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) {
    return ((parseInt(groups[0], 16) << 16) | parseInt(groups[1], 16)) >>> 0;
  }
  if (groups.length === 1 && /^[0-9a-f]{1,4}$/.test(groups[0])) {
    return parseInt(groups[0], 16) >>> 0;
  }
  return null;
}

function isBlockedIpv6(host: string): boolean {
  if (host === '::' || host === '::1') return true;
  if (host.startsWith('::ffff:')) {
    const value = mappedIpv4Value(host.slice(7));
    return value === null ? true : isBlockedIpv4Value(value);
  }
  return (
    host.startsWith('fe8') ||
    host.startsWith('fe9') ||
    host.startsWith('fea') ||
    host.startsWith('feb') ||
    host.startsWith('fc') ||
    host.startsWith('fd')
  );
}

/**
 * Guard for operator-supplied list URLs, applied to the configured URL and
 * to every redirect hop: http(s) only and no loopback, private, link-local
 * or CGNAT targets. Hostnames that merely resolve to private space are not
 * detected; the URLs are admin-configured, so DNS pinning is out of scope.
 */
export function isUnsafeRemoteUrl(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return true;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return true;

  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host.includes(':')) return isBlockedIpv6(host);
  return isBlockedIpv4(host);
}
