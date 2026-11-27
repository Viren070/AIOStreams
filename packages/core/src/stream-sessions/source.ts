const SOURCE_SLUG_MAX_LENGTH = 32;

/** Where a session's bytes come from: addon preset type and service id. */
export interface StreamSource {
  addon?: string;
  service?: string;
}

/**
 * Carries a failover winner's source from the playback route to the proxy
 * that followed it there, whose session opened before the winner was known.
 */
export const STREAM_SOURCE_HEADER = 'x-jjstreams-source';

/** Labels are bounded lowercase slugs, never free text. */
export function sourceSlug(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '')
    .slice(0, SOURCE_SLUG_MAX_LENGTH);
  return slug || undefined;
}

export function formatStreamSource(source: StreamSource): string {
  return `${sourceSlug(source.addon) ?? ''}/${sourceSlug(source.service) ?? ''}`;
}

/** Inverse of {@link formatStreamSource}; an absent part is unknown. */
export function parseStreamSource(value: unknown): StreamSource | undefined {
  if (typeof value !== 'string') return undefined;
  const [addon, service] = value.split('/');
  return { addon: sourceSlug(addon), service: sourceSlug(service) };
}
