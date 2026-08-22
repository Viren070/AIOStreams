export const FAILOVER_ORDER_PATH = 'failover_order';

export type InfiniDyskStreamLike = {
  failoverId?: unknown;
  extra?: unknown;
  meta?: unknown;
  name?: unknown;
  filename?: unknown;
  originalName?: unknown;
  [key: string]: unknown;
};

export type InfiniDyskFailoverStream = {
  name?: string;
  filename?: string;
  originalName?: string;
  extra?: { failoverId?: unknown };
};

function getMetadata(stream: InfiniDyskStreamLike): Record<string, unknown> {
  const metadata = stream.meta;
  return metadata !== null && typeof metadata === 'object'
    ? (metadata as Record<string, unknown>)
    : {};
}

function getMetadataValue(stream: InfiniDyskStreamLike, key: string): unknown {
  return stream[key] ?? getMetadata(stream)[key];
}

export function getInfiniDyskFailoverId(
  stream: InfiniDyskStreamLike
): string | undefined {
  const directValue = getMetadataValue(stream, 'failoverId');
  if (typeof directValue === 'string' && directValue.trim()) {
    return directValue;
  }

  const extra = stream.extra;
  const extraValue =
    extra !== null && typeof extra === 'object'
      ? (extra as Record<string, unknown>).failoverId
      : undefined;
  return typeof extraValue === 'string' && extraValue.trim()
    ? extraValue
    : undefined;
}

export function getInfiniDyskIndexer(
  stream: InfiniDyskStreamLike
): string | undefined {
  const indexer = getMetadata(stream).indexer;
  return typeof indexer === 'string' && indexer.trim()
    ? indexer.trim()
    : undefined;
}

export function getInfiniDyskInLibrary(stream: InfiniDyskStreamLike): boolean {
  return getMetadataValue(stream, 'inLibrary') === true;
}

export function getInfiniDyskProvidedLanguages(
  stream: InfiniDyskStreamLike
): unknown {
  return getMetadataValue(stream, 'languages');
}

export function getInfiniDyskMessage(
  stream: InfiniDyskStreamLike
): string | undefined {
  const parts: string[] = [];
  if (getInfiniDyskInLibrary(stream)) parts.push('Ready');
  if (getMetadataValue(stream, 'availability') === 'available') {
    parts.push('Verified');
  }
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

export function mergeInfiniDyskLanguages(
  existing: string[],
  provided: unknown,
  normalise: (value: unknown) => string | undefined
): string[] {
  const languages = [...existing];
  const values = Array.isArray(provided)
    ? provided
    : typeof provided === 'string'
      ? [provided]
      : [];

  for (const value of values) {
    const language = normalise(value);
    if (language && !languages.includes(language)) {
      languages.push(language);
    }
  }

  return languages;
}

export function getManifestUrlError(name: unknown): Error {
  return new Error(
    `${typeof name === 'string' && name ? name : 'InfiniDysk'} has an invalid Manifest URL. It must be a valid HTTP(S) link to a manifest.json`
  );
}

export function parseInfiniDyskManifestUrl(
  name: unknown,
  manifestUrl: unknown
): string {
  if (typeof manifestUrl !== 'string') {
    throw getManifestUrlError(name);
  }

  let parsedManifestUrl: URL;
  try {
    parsedManifestUrl = new URL(manifestUrl);
  } catch {
    throw getManifestUrlError(name);
  }

  if (
    !['http:', 'https:'].includes(parsedManifestUrl.protocol) ||
    !parsedManifestUrl.pathname.endsWith('/manifest.json')
  ) {
    throw getManifestUrlError(name);
  }

  return parsedManifestUrl.toString();
}

export function getFailoverOrderEndpoint(
  manifestUrl: string
): string | undefined {
  try {
    const endpoint = new URL(manifestUrl);
    endpoint.pathname = endpoint.pathname.replace(
      /\/manifest\.json$/i,
      `/${FAILOVER_ORDER_PATH}`
    );
    return endpoint.toString();
  } catch {
    return undefined;
  }
}

export function buildFailoverOrderBody(streams: InfiniDyskFailoverStream[]): {
  streams: { name?: string; failoverId: string }[];
} {
  return {
    streams: streams.flatMap((stream) => {
      const failoverId = stream.extra?.failoverId;
      if (typeof failoverId !== 'string' || !failoverId.trim()) return [];
      return [
        {
          name: stream.filename ?? stream.originalName,
          failoverId,
        },
      ];
    }),
  };
}

export function reportFailoverOrder(
  streams: InfiniDyskFailoverStream[],
  endpoint: string,
  userAgent: string,
  options: {
    fetchImpl?: typeof fetch;
    onFailure?: () => void;
  } = {}
): Promise<void> {
  const body = buildFailoverOrderBody(streams);
  if (body.streams.length === 0) return Promise.resolve();

  const fetchImpl = options.fetchImpl ?? fetch;
  return fetchImpl(endpoint, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': userAgent,
    },
    signal: AbortSignal.timeout(5000),
  })
    .then((response) => {
      response.body?.cancel();
      if (!response.ok) options.onFailure?.();
    })
    .catch(() => {
      options.onFailure?.();
    });
}
