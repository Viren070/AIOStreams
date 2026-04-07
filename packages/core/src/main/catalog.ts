import {
  createLogger,
  getTimeTakenSincePoint,
  ExtrasParser,
  getSimpleTextHash,
  maskSensitiveInfo,
  constants,
} from '../utils/index.js';
import { Wrapper } from './wrapper.js';
import { createPosterService } from '../poster/index.js';
import { getAddonName } from '../utils/general.js';
import type {
  MetaPreview,
  MergedCatalog,
  Meta,
  Preset,
} from '../db/schemas.js';
import type { Manifest } from '../db/index.js';
import type { AIOStreamsContext, AIOStreamsResponse } from './types.js';
import {
  shuffleCache,
  mergedCatalogCache,
  type MergedCatalogSkipState,
} from './caches.js';

const logger = createLogger('core');

export function convertDiscoverDeepLinks(
  ctx: Pick<AIOStreamsContext, 'addons' | 'manifestUrl'>,
  items: Meta['links']
): Meta['links'] {
  if (!items) {
    return items;
  }
  return items.map((link) => {
    try {
      if (link.url.startsWith('stremio:///discover/')) {
        const linkUrl = new URL(decodeURIComponent(link.url.split('/')[4]));
        const addon = ctx.addons.find(
          (a) => new URL(a.manifestUrl).hostname === linkUrl.hostname
        );
        if (addon) {
          const [_, linkType, catalogIdAndQuery] = link.url
            .replace('stremio:///discover/', '')
            .split('/');
          const newCatalogId = `${addon.instanceId}.${catalogIdAndQuery}`;
          const newTransportUrl = encodeURIComponent(ctx.manifestUrl);
          link.url = `stremio:///discover/${newTransportUrl}/${linkType}/${newCatalogId}`;
        }
      }
    } catch {}
    return link;
  });
}

export async function fetchRawCatalogItems(
  ctx: AIOStreamsContext,
  addonInstanceId: string,
  catalogId: string,
  type: string,
  parsedExtras?: ExtrasParser
): Promise<{
  success: boolean;
  items: MetaPreview[];
  error?: { title: string; description: string };
}> {
  const addon = ctx.addons.find((a) => a.instanceId === addonInstanceId);

  if (!addon) {
    const initError = (
      ctx.addonInitialisationErrors as { addon: Preset; error: string }[]
    ).find((e) => addonInstanceId.startsWith(e.addon.instanceId || ''));
    if (initError) {
      return {
        success: false,
        items: [],
        error: {
          title: `[❌] ${initError.error}`,
          description: `Addon ${addonInstanceId} failed to initialise. Try reinstalling/disabling/uninstalling the addon.`,
        },
      };
    }
    return {
      success: false,
      items: [],
      error: {
        title: `Addon ${addonInstanceId} not found. Try reinstalling the addon.`,
        description: 'Addon not found',
      },
    };
  }

  // Check for type override in modifications
  let actualType = type;
  const modification = ctx.userData.catalogModifications?.find(
    (mod) =>
      mod.id === `${addonInstanceId}.${catalogId}` &&
      (mod.type === type || mod.overrideType === type)
  );
  if (modification?.overrideType) {
    actualType = modification.type;
  }

  if (parsedExtras?.genre === 'None') {
    parsedExtras.genre = undefined;
  }
  const extrasString = parsedExtras?.toString();

  try {
    const start = Date.now();
    const catalog = await new Wrapper(addon).getCatalog(
      actualType,
      catalogId,
      extrasString
    );
    logger.info(
      `Received catalog ${catalogId} of type ${actualType} from ${addon.name} in ${getTimeTakenSincePoint(start)}`
    );
    return { success: true, items: catalog };
  } catch (error) {
    return {
      success: false,
      items: [],
      error: {
        title: `[❌] ${addon.name}`,
        description: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

/**
 * Gets the extras configuration for a specific catalog from an addon's manifest.
 * Used to determine what extras (search, genre, etc.) a catalog supports.
 */
export function getCatalogExtras(
  ctx: Pick<AIOStreamsContext, 'manifests'>,
  addonInstanceId: string,
  catalogId: string,
  catalogType: string
): Manifest['catalogs'][number]['extra'] | undefined {
  const manifest = ctx.manifests[addonInstanceId];
  if (!manifest) return undefined;

  const catalog = manifest.catalogs?.find(
    (c) => c.id === catalogId && c.type === catalogType
  );
  return catalog?.extra;
}

/**
 * Applies poster modifications to catalog items.
 */
export async function applyPosterModifications(
  ctx: AIOStreamsContext,
  items: MetaPreview[],
  type: string,
  applyPosterService: boolean = true
): Promise<MetaPreview[]> {
  const posterApi = applyPosterService
    ? createPosterService(ctx.userData)
    : null;

  return Promise.all(
    items.map(async (item) => {
      if (posterApi && item.poster) {
        let posterUrl = item.poster;
        if (posterApi.isPosterFromThisService(posterUrl)) {
          // already a poster from this service, do nothing
        } else if (ctx.userData.usePosterRedirectApi) {
          const itemId = (item as any).imdb_id || item.id;
          posterUrl = posterApi.buildRedirectUrl(itemId, type, item.poster);
        } else {
          const servicePosterUrl = await posterApi.getPosterUrl(
            type,
            (item as any).imdb_id || item.id,
            false
          );
          if (servicePosterUrl) {
            posterUrl = servicePosterUrl;
          }
        }
        item.poster = posterUrl;
      }

      if (ctx.userData.enhancePosters && Math.random() < 0.2) {
        item.poster = Buffer.from(
          constants.DEFAULT_POSTERS[
            Math.floor(Math.random() * constants.DEFAULT_POSTERS.length)
          ],
          'base64'
        ).toString('utf-8');
      }

      if (item.links) {
        item.links = convertDiscoverDeepLinks(ctx, item.links);
      }
      return item;
    })
  );
}

/**
 * Applies catalog modifications like shuffle, reverse, poster service, etc.
 * Used by getCatalog for standalone catalogs and getMergedCatalog for source catalogs.
 */
export async function applyCatalogModifications(
  ctx: AIOStreamsContext,
  items: MetaPreview[],
  catalogId: string,
  type: string,
  parsedExtras?: ExtrasParser,
  shuffleCacheKey?: string
): Promise<MetaPreview[]> {
  let catalog = [...items];
  const isSearch = parsedExtras?.search;

  const modification = ctx.userData.catalogModifications?.find(
    (mod) =>
      mod.id === catalogId && (mod.type === type || mod.overrideType === type)
  );
  const applyShuffle = modification?.shuffle && !isSearch && shuffleCacheKey;
  const applyReverse = !applyShuffle && modification?.reverse && !isSearch;

  logger.debug(`Applying catalog modifications`, {
    catalogId,
    type,
    modificationFound: !!modification,
    posterService:
      modification?.usePosterService === true &&
      ctx.userData.posterService !== 'none'
        ? ctx.userData.posterService
        : false,
    shuffle: !!applyShuffle,
    reverse: !!applyReverse,
  });

  if (applyShuffle) {
    const cachedShuffle = await shuffleCache.get(shuffleCacheKey);
    if (cachedShuffle) {
      catalog = cachedShuffle;
    } else {
      for (let i = catalog.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [catalog[i], catalog[j]] = [catalog[j], catalog[i]];
      }
      if (modification.persistShuffleFor) {
        await shuffleCache.set(
          shuffleCacheKey,
          catalog,
          modification.persistShuffleFor * 3600
        );
      }
    }
  } else if (applyReverse) {
    catalog = catalog.reverse();
  }

  const applyPosterService = modification?.usePosterService === true;
  catalog = await applyPosterModifications(
    ctx,
    catalog,
    type,
    applyPosterService
  );

  return catalog;
}

/**
 * Extracts a year from releaseInfo which can be a number (year) or string (year or year-year range).
 * For ranges like "2020-2024", returns the first year.
 */
function extractYear(releaseInfo: number | string | undefined | null): number {
  if (releaseInfo === undefined || releaseInfo === null) return 0;
  if (typeof releaseInfo === 'number') return releaseInfo;
  const match = String(releaseInfo).match(/^(\d{4})/);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * Applies merge method to combine items from multiple source catalogs.
 */
function applyMergeMethod(
  itemsBySource: MetaPreview[][],
  method?: MergedCatalog['mergeMethod']
): MetaPreview[] {
  const mergeMethod = method || 'sequential';

  switch (mergeMethod) {
    case 'interleave': {
      const result: MetaPreview[] = [];
      const maxLength = Math.max(0, ...itemsBySource.map((arr) => arr.length));
      for (let i = 0; i < maxLength; i++) {
        for (const sourceItems of itemsBySource) {
          if (i < sourceItems.length) {
            result.push(sourceItems[i]);
          }
        }
      }
      return result;
    }

    case 'imdbRating': {
      const allItems = itemsBySource.flat();
      return allItems.sort((a, b) => {
        const ratingA = parseFloat(a.imdbRating?.toString() ?? '0');
        const ratingB = parseFloat(b.imdbRating?.toString() ?? '0');
        if (isNaN(ratingA) && isNaN(ratingB)) return 0;
        if (isNaN(ratingA)) return 1;
        if (isNaN(ratingB)) return -1;
        return ratingB - ratingA;
      });
    }

    case 'releaseDateAsc': {
      const allItems = itemsBySource.flat();
      return allItems.sort(
        (a, b) => extractYear(a.releaseInfo) - extractYear(b.releaseInfo)
      );
    }

    case 'releaseDateDesc': {
      const allItems = itemsBySource.flat();
      return allItems.sort(
        (a, b) => extractYear(b.releaseInfo) - extractYear(a.releaseInfo)
      );
    }

    case 'sequential':
    default:
      return itemsBySource.flat();
  }
}

function deduplicateMergedCatalog(
  items: MetaPreview[],
  methods?: ('id' | 'title')[]
): MetaPreview[] {
  if (!methods || methods.length === 0) {
    return items;
  }

  const seenIds = new Set<string>();
  const seenTitles = new Set<string>();

  return items.filter((item) => {
    const itemIds = [item.id, (item as any).imdb_id].filter(Boolean);
    const title = (item.name || item.id).toLowerCase();

    const isDuplicateById =
      methods.includes('id') && itemIds.some((id) => seenIds.has(id));
    const isDuplicateByTitle =
      methods.includes('title') && seenTitles.has(title);

    if (isDuplicateById || isDuplicateByTitle) {
      return false;
    }

    itemIds.forEach((id) => seenIds.add(id));
    seenTitles.add(title);
    return true;
  });
}

export async function getMergedCatalog(
  ctx: AIOStreamsContext,
  type: string,
  id: string,
  extras?: string
): Promise<AIOStreamsResponse<MetaPreview[]>> {
  const start = Date.now();
  const mergedCatalog = ctx.userData.mergedCatalogs?.find((mc) => mc.id === id);

  if (!mergedCatalog) {
    logger.error(`Merged catalog ${id} not found`);
    return {
      success: false,
      data: [],
      errors: [
        {
          title: `Merged catalog ${id} not found`,
          description: 'Try reinstalling the addon.',
        },
      ],
    };
  }

  if (mergedCatalog.type !== type) {
    logger.error(
      `Merged catalog ${id} type mismatch: expected ${mergedCatalog.type}, got ${type}`
    );
    return {
      success: false,
      data: [],
      errors: [
        {
          title: `Type mismatch for merged catalog ${id}`,
          description: `Expected ${mergedCatalog.type}, got ${type}`,
        },
      ],
    };
  }

  const parsedExtras = new ExtrasParser(extras);
  const requestedSkip = parsedExtras.skip || 0;
  const isSearchRequest = !!parsedExtras.search;
  const requestedGenre = parsedExtras.genre;

  const extrasForCacheKey = new ExtrasParser(extras);
  extrasForCacheKey.skip = undefined;
  const extrasCacheKeyPart = extrasForCacheKey.toString();

  const configHash = getSimpleTextHash(
    JSON.stringify({
      catalogIds: mergedCatalog.catalogIds,
      deduplicationMethods: mergedCatalog.deduplicationMethods,
      mergeMethod: mergedCatalog.mergeMethod,
    })
  );
  const baseCacheKey = `${id}-${ctx.userData.uuid}-${configHash}${extrasCacheKeyPart ? `-${extrasCacheKeyPart}` : ''}`;
  const skipCacheKey = `${baseCacheKey}-skip=${requestedSkip}`;

  let skipState: MergedCatalogSkipState | undefined;

  if (requestedSkip === 0) {
    skipState = { sourceSkips: {} };
    for (const encodedCatalogId of mergedCatalog.catalogIds) {
      skipState.sourceSkips[encodedCatalogId] = 0;
    }
  } else {
    skipState = await mergedCatalogCache.get(skipCacheKey);
    if (!skipState) {
      logger.warn(
        `No cached state for merged catalog ${id} at skip=${requestedSkip}. ` +
          `Cache may have expired or skip value is invalid.`
      );
      return { success: true, data: [], errors: [] };
    }
  }

  const nextSourceSkips: Record<string, number> = {
    ...skipState.sourceSkips,
  };

  const fetchPromises = mergedCatalog.catalogIds.map(
    async (encodedCatalogId: string) => {
      logger.debug(`Handling merged catalog source`, { encodedCatalogId });
      const params = new URLSearchParams(encodedCatalogId);
      const catalogId = params.get('id');
      const catalogType = params.get('type');
      if (!catalogId || !catalogType) {
        return {
          encodedCatalogId,
          items: [],
          fetched: 0,
          success: false,
          skipped: false,
        };
      }

      const addonInstanceId = catalogId.split('.', 2)[0];
      const actualCatalogId = catalogId.split('.').slice(1).join('.');

      const catalogExtras = getCatalogExtras(
        ctx,
        addonInstanceId,
        actualCatalogId,
        catalogType
      );

      if (isSearchRequest && !catalogExtras?.some((e) => e.name === 'search')) {
        logger.debug(
          `Skipping source ${encodedCatalogId} for merged catalog ${mergedCatalog.name}: doesn't support search`
        );
        return {
          encodedCatalogId,
          items: [],
          fetched: 0,
          success: true,
          skipped: true,
        };
      }

      if (requestedGenre && requestedGenre !== 'None') {
        const genreExtra = catalogExtras?.find((e) => e.name === 'genre');
        if (!genreExtra) {
          logger.debug(
            `Skipping source ${encodedCatalogId} for merged catalog ${mergedCatalog.name}: doesn't support genre extra`
          );
          return {
            encodedCatalogId,
            items: [],
            fetched: 0,
            success: true,
            skipped: true,
          };
        }
        if (genreExtra.options && genreExtra.options.length > 0) {
          const hasGenre = genreExtra.options.some(
            (opt) => opt === requestedGenre || opt === null
          );
          if (!hasGenre) {
            logger.debug(
              `Skipping source ${encodedCatalogId} for merged catalog ${mergedCatalog.name}: doesn't have genre "${requestedGenre}"`
            );
            return {
              encodedCatalogId,
              items: [],
              fetched: 0,
              success: true,
              skipped: true,
            };
          }
        }
      }

      const sourceSkip = skipState!.sourceSkips[encodedCatalogId] || 0;
      const supportsSkip = catalogExtras?.some((e) => e.name === 'skip');

      if (!supportsSkip && sourceSkip > 0) {
        logger.debug(
          `Skipping source ${encodedCatalogId} for merged catalog ${mergedCatalog.name}: doesn't support skip and already fetched (exhausted)`
        );
        return {
          encodedCatalogId,
          items: [],
          fetched: 0,
          success: true,
          skipped: true,
        };
      }

      const sourceExtras = new ExtrasParser(extras);
      if (supportsSkip) {
        sourceExtras.skip = sourceSkip > 0 ? sourceSkip : undefined;
      } else {
        sourceExtras.skip = undefined;
      }

      const requiredExtras = catalogExtras?.filter((e) => e.isRequired);
      if (requiredExtras && requiredExtras.length > 0) {
        for (const reqExtra of requiredExtras) {
          if (!sourceExtras.has(reqExtra.name)) {
            logger.debug(
              `Skipping source ${encodedCatalogId} for merged catalog ${mergedCatalog.name}: missing required extra "${reqExtra.name}"`
            );
            return {
              encodedCatalogId,
              items: [],
              fetched: 0,
              success: true,
              skipped: true,
            };
          }
        }
      }

      logger.debug('Fetching merged catalog source', {
        encodedCatalogId,
        addonInstanceId,
        catalogType,
        constructedExtras: sourceExtras.toString(),
      });

      const result = await fetchRawCatalogItems(
        ctx,
        addonInstanceId,
        actualCatalogId,
        catalogType,
        sourceExtras
      );

      if (!result.success) {
        logger.warn(
          `Failed to fetch source catalog ${encodedCatalogId} for merged catalog ${mergedCatalog.name} at skip=${requestedSkip}: ${
            result.error
              ? maskSensitiveInfo(result.error.description || '')
              : 'Unknown error'
          }`
        );
        return {
          encodedCatalogId,
          items: [],
          fetched: 0,
          success: false,
          skipped: false,
        };
      }

      return {
        encodedCatalogId,
        items: result.items,
        fetched: result.items.length,
        success: true,
        skipped: false,
      };
    }
  );

  logger.debug(
    `Fetching merged catalog ${mergedCatalog.name} at skip=${requestedSkip}`,
    {
      upstreamAddons: fetchPromises.length,
    }
  );

  const fetchResults = await Promise.all(fetchPromises);

  const nonSkippedResults = fetchResults.filter((r) => !r.skipped);
  const allFailed =
    nonSkippedResults.length > 0 && nonSkippedResults.every((r) => !r.success);
  if (allFailed) {
    logger.error(`All sources failed for merged catalog ${mergedCatalog.name}`);
    return {
      success: false,
      data: [],
      errors: [
        {
          title: `All sources failed for merged catalog ${mergedCatalog.name}`,
          description:
            'Unable to fetch items from any source catalog. Please try again later.',
        },
      ],
    };
  }

  const itemsBySource: MetaPreview[][] = [];
  for (const { encodedCatalogId, items, fetched, skipped } of fetchResults) {
    if (skipped) continue;
    nextSourceSkips[encodedCatalogId] =
      (skipState.sourceSkips[encodedCatalogId] || 0) + fetched;
    itemsBySource.push(items);
  }

  let allItems: MetaPreview[] = applyMergeMethod(
    itemsBySource,
    mergedCatalog.mergeMethod
  );

  logger.debug(
    `Merged catalog ${mergedCatalog.name} collected ${allItems.length} items before deduplication`
  );

  allItems = deduplicateMergedCatalog(
    allItems,
    mergedCatalog.deduplicationMethods
  );

  const shuffleCacheKey = `${baseCacheKey}-skip=${requestedSkip}-shuffle`;

  allItems = await applyCatalogModifications(
    ctx,
    allItems,
    id,
    type,
    parsedExtras,
    shuffleCacheKey
  );

  const nextSkip = requestedSkip + allItems.length;

  if (allItems.length > 0) {
    const nextSkipCacheKey = `${baseCacheKey}-skip=${nextSkip}`;
    await mergedCatalogCache.set(
      nextSkipCacheKey,
      { sourceSkips: nextSourceSkips },
      3600
    );
  }

  logger.info(
    `Merged catalog ${mergedCatalog.name} fetched ${allItems.length} items at skip=${requestedSkip}, next skip=${nextSkip} in ${getTimeTakenSincePoint(start)}`
  );

  return { success: true, data: allItems, errors: [] };
}

export async function getCatalog(
  ctx: AIOStreamsContext,
  type: string,
  id: string,
  extras?: string
): Promise<AIOStreamsResponse<MetaPreview[]>> {
  logger.info(`Handling catalog request`, { type, id, extras });

  if (id.startsWith('aiostreams.merged.')) {
    return getMergedCatalog(ctx, type, id, extras);
  }

  const addonInstanceId = id.split('.', 2)[0];
  const actualCatalogId = id.split('.').slice(1).join('.');

  const parsedExtras = new ExtrasParser(extras);

  const result = await fetchRawCatalogItems(
    ctx,
    addonInstanceId,
    actualCatalogId,
    type,
    parsedExtras
  );

  if (!result.success) {
    if (extras && extras.includes('skip')) {
      return { success: true, data: [], errors: [] };
    }
    return {
      success: false,
      data: [],
      errors: result.error ? [result.error] : [],
    };
  }

  const shuffleCacheKey = `${type}-${actualCatalogId}-${parsedExtras?.toString() || ''}-${ctx.userData.uuid}`;

  const catalog = await applyCatalogModifications(
    ctx,
    result.items,
    id,
    type,
    parsedExtras,
    shuffleCacheKey
  );

  return { success: true, data: catalog, errors: [] };
}
