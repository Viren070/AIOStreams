import { config as appConfig } from '../config/index.js';
import { resolveConfigAlias } from '../db/repositories/config-profiles.js';
import { isConfigUuid } from '../utils/config-alias.js';
import { APIError, ErrorCode } from '../utils/constants.js';

/** `/stremio/u/<alias>/...` or `/stremio/<uuid>/<encryptedPassword>/...`, with an optional `/v/<ids>`. */
const MANIFEST_PATH =
  /^\/stremio\/(?:u\/([^/]+)|([^/]+)\/([^/]+))((?:\/v\/[^/]+)?)\/manifest\.json$/;

export const MAX_MANIFEST_URLS = 8;

/** One of our manifest URLs, in the form we hand out and the form we read. */
export interface OwnManifestUrl {
  /** What we store and hand out. */
  url: string;
  /**
   * The same manifest with the alias expanded.
   */
  fetchUrl: string;
  /**
   * The addon this URL names, with the encrypted password masked out. Two URLs
   * that differ only by a re-minted password share one.
   */
  identity: string;
}

function baseUrl(): string {
  const configured = appConfig.bootstrap.baseUrl;
  if (!configured) {
    throw new APIError(
      ErrorCode.INTERNAL_SERVER_ERROR,
      500,
      'This instance has no BASE_URL configured, so it cannot tell other services where to find your addon.'
    );
  }
  return configured.replace(/\/+$/, '');
}

function reject(message: string): never {
  throw new APIError(ErrorCode.BAD_REQUEST, 400, message);
}

/**
 * Only URLs this instance serves for this user may be pushed. Everything a
 * linked account fetches or hands to a platform passes through here, so a
 * caller cannot aim the server at an arbitrary host or at another user's
 * configuration.
 */
export async function assertOwnManifestUrl(
  rawUrl: string,
  uuid: string
): Promise<OwnManifestUrl> {
  const base = baseUrl();
  const url = rawUrl.trim();

  let parsed: URL;
  let parsedBase: URL;
  try {
    parsed = new URL(url);
    parsedBase = new URL(base);
  } catch {
    reject('That is not a valid manifest URL.');
  }

  if (parsed.origin !== parsedBase.origin) {
    reject(`A manifest URL must be served by this instance (${base}).`);
  }

  const path = parsed.pathname.slice(
    parsedBase.pathname.replace(/\/$/, '').length
  );
  const match = MANIFEST_PATH.exec(path);
  if (!match) {
    reject('That is not an AIOStreams manifest URL.');
  }

  for (const key of parsed.searchParams.keys()) {
    if (key !== 'v')
      reject('A manifest URL cannot carry extra query parameters.');
  }

  const [, alias, pathUuid, , variant] = match;

  if (alias !== undefined) {
    // Resolved the way the request path resolves it, so a URL that validates
    // here is one the alias route will answer.
    const target = await resolveConfigAlias(decodeURIComponent(alias));
    if (!target || target.uuid !== uuid) {
      reject('That manifest URL belongs to a different configuration.');
    }
    return {
      url,
      fetchUrl: `${base}/stremio/${target.uuid}/${target.encryptedPassword}${variant}/manifest.json${parsed.search}`,
      identity: `${base}/stremio/u/${decodeURIComponent(alias)}${variant}/manifest.json${parsed.search}`,
    };
  }

  if (
    !isConfigUuid(pathUuid) ||
    pathUuid.toLowerCase() !== uuid.toLowerCase()
  ) {
    reject('That manifest URL belongs to a different configuration.');
  }

  return {
    url,
    fetchUrl: url,
    identity: `${base}/stremio/${pathUuid.toLowerCase()}/*${variant}/manifest.json${parsed.search}`,
  };
}

export async function assertOwnManifestUrls(
  urls: string[],
  uuid: string
): Promise<OwnManifestUrl[]> {
  if (urls.length === 0) {
    reject('At least one manifest URL is required.');
  }
  if (urls.length > MAX_MANIFEST_URLS) {
    reject(`At most ${MAX_MANIFEST_URLS} manifest URLs can be kept in sync.`);
  }
  const seen = new Set<string>();
  const validated: OwnManifestUrl[] = [];
  for (const url of urls) {
    const ok = await assertOwnManifestUrl(url, uuid);
    if (seen.has(ok.url)) continue;
    seen.add(ok.url);
    validated.push(ok);
  }
  return validated;
}
