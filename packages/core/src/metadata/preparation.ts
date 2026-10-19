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
