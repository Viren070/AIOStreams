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
  const hostname = url.hostname.toLowerCase();

  if (
    hostname === 'localhost' ||
    hostname === 'host.docker.internal' ||
    hostname.endsWith('.local')
  ) {
    return true;
  }

  if (!hostname.includes('.')) {
    return true;
  }

  if (/^(127\.)/.test(hostname)) return true;
  if (/^(10\.)/.test(hostname)) return true;
  if (/^(192\.168\.)/.test(hostname)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname)) return true;
  if (/^169\.254\./.test(hostname)) return true;

  if (hostname === '::1' || hostname.startsWith('fe80:')) return true;
  if (hostname.startsWith('fc') || hostname.startsWith('fd')) return true;

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
