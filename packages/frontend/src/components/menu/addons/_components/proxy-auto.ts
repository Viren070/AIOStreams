function standardiseManifestUrl(url: string): string {
  return url.replace(/^stremio:\/\//, 'https://').replace(/\/$/, '');
}

function extractManifestUrl(options: Record<string, any>): string | undefined {
  const rawManifestUrl =
    typeof options?.manifestUrl === 'string'
      ? options.manifestUrl
      : typeof options?.url === 'string'
        ? options.url
        : undefined;

  if (!rawManifestUrl) {
    return undefined;
  }

  const manifestUrl = standardiseManifestUrl(rawManifestUrl);
  try {
    const parsed = new URL(manifestUrl);
    if (!parsed.pathname.endsWith('/manifest.json')) {
      return undefined;
    }
    return manifestUrl;
  } catch {
    return undefined;
  }
}

function isInternalEndpoint(url: URL): boolean {
  const rawHostname = url.hostname.toLowerCase();
  const hostname =
    rawHostname.startsWith('[') && rawHostname.endsWith(']')
      ? rawHostname.slice(1, -1)
      : rawHostname;
  const ipv4Match = hostname.match(/^(\d{1,3})(?:\.(\d{1,3})){3}$/);
  const isIpv4Literal = (() => {
    if (!ipv4Match) return false;
    const octets = hostname.split('.').map((v) => Number(v));
    return octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255);
  })();

  if (
    hostname === 'localhost' ||
    hostname === 'host.docker.internal' ||
    hostname.endsWith('.local')
  ) {
    return true;
  }

  if (isIpv4Literal) {
    const [first, second] = hostname.split('.').map((v) => Number(v));
    if (first === 127) return true;
    if (first === 10) return true;
    if (first === 192 && second === 168) return true;
    if (first === 172 && second >= 16 && second <= 31) return true;
    if (first === 169 && second === 254) return true;
  }

  if (hostname === '::1' || /^fe[89ab][0-9a-f]:/i.test(hostname)) return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(hostname)) return true;

  if (!hostname.includes('.') && !hostname.includes(':')) return true;

  return false;
}

export function shouldAutoProxyInternalAddon(options: Record<string, any>): {
  shouldAutoProxy: boolean;
  manifestUrl?: string;
} {
  const manifestUrl = extractManifestUrl(options);
  if (!manifestUrl) {
    return { shouldAutoProxy: false };
  }

  try {
    const parsed = new URL(manifestUrl);
    if (parsed.protocol !== 'http:') {
      return { shouldAutoProxy: false, manifestUrl };
    }
    return {
      shouldAutoProxy: isInternalEndpoint(parsed),
      manifestUrl,
    };
  } catch {
    return { shouldAutoProxy: false };
  }
}

export function applyInternalAddonProxyConfig<T extends { proxy?: any }>(
  userData: T,
  addonInstanceId: string
): { nextUserData: T; autoEnabledProxy: boolean } {
  const currentProxy = userData.proxy ?? {};
  const canEnableProxy =
    !!currentProxy.id && !!currentProxy.url && !!currentProxy.credentials;

  const proxiedAddons = new Set<string>(currentProxy.proxiedAddons ?? []);
  proxiedAddons.add(addonInstanceId);

  return {
    nextUserData: {
      ...userData,
      proxy: {
        ...currentProxy,
        enabled: canEnableProxy ? true : currentProxy.enabled,
        proxiedAddons: [...proxiedAddons],
      },
    },
    autoEnabledProxy: canEnableProxy,
  };
}
