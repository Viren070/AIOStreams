import { Cache, Env, createLogger } from '../utils/index.js';
import { ParsedStream } from '../db/schemas.js';
import { DebridError } from '../debrid/base.js';
import { hashNzbUrl, buildFallbackKey } from '../debrid/utils.js';

const logger = createLogger('nzbFailover');

export interface NzbFallback {
  /** The fallback NZB URL to try. */
  nzbUrl: string;
  /** Pre-computed hash of the NZB URL (used for lock/cache keys in resolve). */
  hash: string;
  /** Best-guess filename for this NZB, used for folder-name derivation. */
  filename?: string;
}

function nzbFallbackCache() {
  return Cache.getInstance<string, NzbFallback[]>(
    'nzb-fallback',
    1_000_000_000,
    Env.REDIS_URI ? 'redis' : 'sql'
  );
}

/**
 * Populate NZB fallback store for a set of streams.
 */
export async function populateNzbFallbacks(
  streams: ParsedStream[],
  count: number,
  uuid?: string
): Promise<void> {
  const usenetStreams = streams.filter(
    (s) => s.type === 'usenet' && s.url && s.nzbUrl
  );

  if (usenetStreams.length < 2) {
    return;
  }

  const seen = new Set<string>();
  const deduped: ParsedStream[] = [];
  for (const stream of usenetStreams) {
    const nzbUrl = stream.nzbUrl!;
    if (!seen.has(nzbUrl)) {
      seen.add(nzbUrl);
      deduped.push(stream);
    }
  }

  if (deduped.length < 2) {
    return;
  }

  // Build the full ordered list once.
  const fullList: NzbFallback[] = deduped.map((s) => ({
    nzbUrl: s.nzbUrl!,
    hash: hashNzbUrl(s.nzbUrl!),
    filename: s.filename,
  }));

  // Keyed by uuid + all NZB URLs.
  const listKey = buildFallbackKey(
    uuid,
    deduped.map((s) => s.nzbUrl!).join('|')
  );
  const ttl = Env.BUILTIN_PLAYBACK_LINK_VALIDITY;
  await nzbFallbackCache().set(listKey, fullList, ttl);

  logger.debug(`Stored NZB fallback list under key ${listKey}`);

  // Stamp each stream URL with its list position so the resolver can slice.
  for (let i = 0; i < deduped.length; i++) {
    const stream = deduped[i];
    if (stream.url) {
      const sep = stream.url.includes('?') ? '&' : '?';
      stream.url = `${stream.url}${sep}fbk=${encodeURIComponent(`${i}:::${count}:::${listKey}`)}`;
    }
  }
}

/**
 * Look up NZB fallback entries using the composite `?fbk=` value embedded in
 * the playback URL: `<index>:::< count>:::<listKey>`.
 */
export async function getNzbFallbacks(fbk: string): Promise<NzbFallback[]> {
  const parts = fbk.split(':::');
  if (parts.length !== 3) return [];
  const index = parseInt(parts[0], 10);
  const count = parseInt(parts[1], 10);
  const listKey = parts[2];
  if (isNaN(index) || isNaN(count) || !listKey) return [];
  const list = await nzbFallbackCache().get(listKey);
  if (!list) return [];
  return list.slice(index + 1, index + 1 + count);
}

/**
 * Determine whether an error warrants retrying with a different NZB URL.
 */
export function isNzbRetryableError(error: DebridError | Error): boolean {
  const code = (error as any).code;
  switch (code) {
    case 'UNAUTHORIZED':
    case 'FORBIDDEN':
    case 'TOO_MANY_REQUESTS':
    case 'PAYMENT_REQUIRED':
    case 'STORE_LIMIT_EXCEEDED':
    case 'UNAVAILABLE_FOR_LEGAL_REASONS':
    case 'NOT_IMPLEMENTED':
      return false;
    default:
      return true;
  }
}
