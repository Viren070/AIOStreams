import { config as appConfig } from '../config/index.js';
import { AnimeDatabase } from '../anime-database/index.js';
import { enrichParsedIdWithAnimeEntry } from '../anime-database/enrich.js';
import { IdParser } from '../utils/id-parser.js';
import { MetadataService } from './service.js';

// Only local routes using BaseDebridAddon's shared MetadataService belong here.
// External URL overrides and Library's direct item IDs keep their
// existing immediate execution path.
const metadataBuiltins = new Set([
  'newznab',
  'torznab',
  'easynews',
  'library',
  'prowlarr',
  'knaben',
  'torrent-galaxy',
  'therarbg',
  'the-pirate-bay',
  'seadex',
  'tsukihime',
  'eztv',
  'torbox-search',
]);

/**
 * Match manifests against INTERNAL_URL's origin and base path plus /builtins/.
 *
 * @returns The [addon, encoded config, manifest.json] path segments for an exact
 * three-segment route, or undefined for external origins or nonmatching paths.
 * @throws {TypeError} If either URL cannot be parsed.
 */
function localBuiltinParts(manifestUrl: string): string[] | undefined {
  const url = new URL(manifestUrl);
  const internal = new URL(appConfig.bootstrap.internalUrl);
  const prefix = internal.pathname.replace(/\/$/, '') + '/builtins/';
  if (url.origin !== internal.origin || !url.pathname.startsWith(prefix))
    return;
  const parts = url.pathname.slice(prefix.length).split('/');
  return parts.length === 3 && parts[2] === 'manifest.json' ? parts : undefined;
}

/** TorBox searches by ID before the base class awaits metadata for processing. */
export function startsSearchBeforeMetadata(manifestUrl: string): boolean {
  return localBuiltinParts(manifestUrl)?.[0] === 'torbox-search';
}

/**
 * Prepare shared metadata for supported local built-in streams using the route's
 * credentials, enriching parsed IDs with anime data when needed. Skip external or
 * unsupported routes, unparseable IDs (including direct Library item IDs), and
 * configuration decode/shape or metadata credential validation failures. The route
 * reports configuration errors.
 *
 * Anime lookup and metadata preparation share the maxTimeout waiting budget,
 * separate from the addon's execution timeout. Failures and timeout reject.
 * Timeout does not cancel underlying work; any lease acquired after expiry is
 * released here.
 *
 * @returns Undefined when skipped, otherwise an idempotent metadata lease release
 * callback owned by the caller. Retain the lease through the internal HTTP hop
 * until resource work settles, including intentional background work, then release.
 */
export async function prepareBuiltinStream(
  manifestUrl: string,
  type: string,
  id: string
): Promise<(() => void) | undefined> {
  const parts = localBuiltinParts(manifestUrl);
  if (!parts || !metadataBuiltins.has(parts[0])) return;
  const parsedId = IdParser.parse(id, type);
  if (!parsedId) return;
  // Use the actual route configuration, including full-manifest overrides,
  // rather than assuming it uses the parent's metadata credentials.
  let config;
  try {
    config = JSON.parse(
      Buffer.from(decodeURIComponent(parts[1]), 'base64url').toString()
    );
  } catch {
    return; // Let the route report its normal configuration error.
  }
  if (
    !config ||
    typeof config !== 'object' ||
    Array.isArray(config) ||
    ['tmdbReadAccessToken', 'tmdbApiKey', 'tvdbApiKey'].some(
      (key) => config[key] !== undefined && typeof config[key] !== 'string'
    )
  )
    return;

  const budget = appConfig.userLimits.timeouts.maxTimeout;
  const deadline = Date.now() + budget;
  let expired = false;
  let timer: NodeJS.Timeout | undefined;
  const preparation = (async () => {
    const animeEntry = await AnimeDatabase.getInstance().getEntryById(
      parsedId.type,
      parsedId.value,
      parsedId.season ? Number(parsedId.season) : undefined,
      parsedId.episode ? Number(parsedId.episode) : undefined
    );
    if (expired) return;
    if (animeEntry && !parsedId.season)
      enrichParsedIdWithAnimeEntry(parsedId, animeEntry);
    const release = await new MetadataService({
      tmdbAccessToken: config.tmdbReadAccessToken,
      tmdbApiKey: config.tmdbApiKey,
      tvdbApiKey: config.tvdbApiKey,
    }).prepare(
      parsedId,
      type === 'movie' ? 'movie' : 'series',
      Math.max(1, deadline - Date.now())
    );
    if (expired) release();
    else return release;
  })();
  try {
    return await Promise.race([
      preparation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          expired = true;
          reject(new Error('Required metadata preparation timed out'));
        }, budget);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
