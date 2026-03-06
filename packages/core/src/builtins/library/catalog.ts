import {
  BuiltinServiceId,
  constants,
  createLogger,
} from '../../utils/index.js';
import {
  DebridDownload,
  getDebridService,
  isTorrentDebridService,
  isUsenetDebridService,
} from '../../debrid/index.js';
import { Manifest, MetaPreview } from '../../db/schemas.js';
import { formatBytes } from '../../formatters/utils.js';
import { parseTorrentTitle, ParsedResult } from '@viren070/parse-torrent-title';
import { normaliseTitle } from '../../parser/utils.js';
import { token_set_ratio } from 'fuzzball';

const logger = createLogger('library:catalog');

export const LIBRARY_ID_PREFIX = 'aiostreams::library.';
export const CATALOG_PAGE_SIZE = 100;
enum Genre {
  ACTIONS = 'Actions',
  TITLE_ASC = 'Title A-Z',
  TITLE_DESC = 'Title Z-A',
  ADDED_ASC = 'Date Added ↑',
  ADDED_DESC = 'Date Added ↓',
}

export type CatalogSort = 'added' | 'title';

export interface CatalogItem extends DebridDownload {
  serviceId: BuiltinServiceId;
  serviceCredential: string;
  itemType: 'torrent' | 'usenet';
}

/** CatalogItem with pre-parsed title information, computed once and reused. */
interface ParsedCatalogItem {
  item: CatalogItem;
  parsed: ParsedResult;
  /** The parsed title (e.g. "Clannad After Story") */
  parsedTitle: string;
  /** Normalised parsed title for comparison (e.g. "clannadafterstory") */
  normalisedTitle: string;
}

function parseCatalogItems(items: CatalogItem[]): ParsedCatalogItem[] {
  return items.map((item) => {
    const parsed = parseTorrentTitle(item.name ?? '');
    const parsedTitle = parsed.title ?? item.name ?? '';
    return {
      item,
      parsed,
      parsedTitle,
      normalisedTitle: normaliseTitle(parsedTitle),
    };
  });
}

export function buildIdPrefixes(
  services: { id: BuiltinServiceId }[]
): string[] {
  return services.map((service) => `${LIBRARY_ID_PREFIX}${service.id}`);
}

export function buildCatalogs(
  services: { id: BuiltinServiceId }[],
  sources?: ('torrent' | 'nzb')[],
  showRefreshActions: string[] = ['catalog']
): Manifest['catalogs'] {
  const catalogs: Manifest['catalogs'] = [];
  const includeActions = showRefreshActions.includes('catalog');

  for (const service of services) {
    const serviceMeta = constants.SERVICE_DETAILS[service.id];
    const genreOptions = [
      Genre.ADDED_DESC,
      Genre.ADDED_ASC,
      Genre.TITLE_ASC,
      Genre.TITLE_DESC,
    ];
    if (includeActions) {
      genreOptions.push(Genre.ACTIONS);
    }

    catalogs.push({
      type: 'library',
      id: `${LIBRARY_ID_PREFIX}${service.id}`,
      name: `${serviceMeta.name}`,
      extra: [
        { name: 'skip' },
        { name: 'search' },
        {
          name: 'genre',
          options: genreOptions,
          isRequired: false,
        },
      ],
    });
  }

  return catalogs;
}

export async function fetchCatalog(
  serviceId: BuiltinServiceId,
  serviceCredential: string,
  clientIp: string | undefined,
  sources: ('torrent' | 'nzb')[],
  skip: number,
  sort: CatalogSort,
  sortDirection: 'asc' | 'desc',
  genre?: string,
  search?: string
): Promise<MetaPreview[]> {
  if (genre === Genre.ACTIONS) {
    if (skip > 0) {
      return [];
    }
    return [
      {
        id: `${LIBRARY_ID_PREFIX}${serviceId}.action.refresh`,
        type: 'library',
        name: '🔄 Refresh Library',
        description:
          'Force refresh the library cache for this service. Use this if your library seems outdated.',
        posterShape: 'landscape',
      },
    ];
  }

  const debridService = getDebridService(
    serviceId,
    serviceCredential,
    clientIp
  );
  const items: CatalogItem[] = [];

  const includeTorrents =
    (!sources || sources.length === 0 || sources.includes('torrent')) &&
    isTorrentDebridService(debridService);
  const includeNzbs =
    (!sources || sources.length === 0 || sources.includes('nzb')) &&
    isUsenetDebridService(debridService);

  const [magnets, nzbs] = await Promise.allSettled([
    includeTorrents ? debridService.listMagnets() : Promise.resolve([]),
    includeNzbs && debridService.listNzbs
      ? debridService.listNzbs()
      : Promise.resolve([]),
  ]);

  if (magnets.status === 'fulfilled') {
    for (const item of magnets.value) {
      if (!item.name) continue;
      if (item.status !== 'cached' && item.status !== 'downloaded') continue;
      items.push({
        ...item,
        serviceId,
        serviceCredential,
        itemType: 'torrent',
      });
    }
  } else {
    logger.warn(`Failed to list magnets from ${serviceId}`, {
      error: magnets.reason?.message,
    });
  }

  if (nzbs.status === 'fulfilled') {
    for (const item of nzbs.value) {
      if (!item.name) continue;
      if (item.status !== 'cached' && item.status !== 'downloaded') continue;
      items.push({
        ...item,
        serviceId,
        serviceCredential,
        itemType: 'usenet',
      });
    }
  } else {
    logger.warn(`Failed to list NZBs from ${serviceId}`, {
      error: nzbs.reason?.message,
    });
  }

  // Filter by search query if provided
  const parsed = parseCatalogItems(items);
  let results: ParsedCatalogItem[];
  if (search) {
    results = searchItems(parsed, search);
  } else {
    results = parsed;
    sortParsedItems(results, sort, sortDirection);
  }

  const page = results.slice(skip, skip + CATALOG_PAGE_SIZE);
  return page.map((entry) => createMetaPreview(entry));
}

export function parseExtras(extras?: string): {
  skip: number;
  sort: CatalogSort;
  sortDirection: 'asc' | 'desc';
  genre?: string;
  search?: string;
} {
  let skip = 0;
  let sort: CatalogSort = 'added';
  let sortDirection: 'asc' | 'desc' = 'desc';
  let genre: string | undefined;
  let search: string | undefined;

  if (extras) {
    const params = Object.fromEntries(
      extras.split('&').map((e) => {
        const [key, ...rest] = e.split('=');
        return [key, decodeURIComponent(rest.join('='))];
      })
    );
    if (params.skip) skip = parseInt(params.skip, 10) || 0;
    if (params.search) search = params.search;
    if (params.genre) {
      genre = params.genre;
      if (genre === Genre.ACTIONS) {
        // Actions genre handled separately, don't parse as sort
      } else if (genre.includes('Title')) {
        sort = 'title';
        sortDirection = genre.includes('Z-A') ? 'desc' : 'asc';
      } else {
        sort = 'added';
        sortDirection = genre.includes('↑') ? 'asc' : 'desc';
      }
    }
  }

  return { skip, sort, sortDirection, genre, search };
}

const SEARCH_FUZZY_THRESHOLD = 65;

/**
 * Check if the normalised query aligns at a word boundary in the title.
 * Splits the title into words, normalises each, then checks if any
 * contiguous run of normalised words (joined) starts with the normalised query.
 */
function matchesAtWordBoundary(
  titleWords: string[],
  normalisedQuery: string
): boolean {
  for (let i = 0; i < titleWords.length; i++) {
    let joined = '';
    for (let j = i; j < titleWords.length; j++) {
      joined += titleWords[j];
      if (joined.length >= normalisedQuery.length) {
        if (joined.startsWith(normalisedQuery)) return true;
        break;
      }
    }
  }
  return false;
}

/**
 * Check if query words have word-level alignment with title words.
 */
function hasWordLevelAlignment(
  queryWords: string[],
  titleWords: string[]
): boolean {
  if (queryWords.length === 0 || titleWords.length === 0) return false;
  return queryWords.every((qw) =>
    titleWords.some((tw) => {
      // Exact prefix/suffix match at normalised level
      if (tw.startsWith(qw) || tw === qw) return true;
      // Fuzzy match between individual words (high threshold)
      return token_set_ratio(qw, tw) >= 80;
    })
  );
}

/**
 * Search items by query using normalised matching and fuzzy scoring
 */
function searchItems(
  items: ParsedCatalogItem[],
  query: string
): ParsedCatalogItem[] {
  const normalisedQuery = normaliseTitle(query);
  if (!normalisedQuery) return items;

  // Pre-split query into normalised words for word-level checks
  const queryWords = query
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map(normaliseTitle)
    .filter(Boolean);

  const scored: { entry: ParsedCatalogItem; score: number }[] = [];

  for (const entry of items) {
    let score = 0;

    // Normalise the parsed title's words for word-boundary checks
    const titleWords = entry.parsedTitle
      .split(/[^a-zA-Z0-9]+/)
      .filter(Boolean)
      .map(normaliseTitle)
      .filter(Boolean);

    const hasWordBoundaryMatch = matchesAtWordBoundary(
      titleWords,
      normalisedQuery
    );

    const wordAligned = hasWordBoundaryMatch
      ? true
      : hasWordLevelAlignment(queryWords, titleWords);

    // 1. Exact normalised title match → highest priority
    if (entry.normalisedTitle === normalisedQuery) {
      score = 110;
    }
    // 2. Word-boundary containment in parsed title
    else if (hasWordBoundaryMatch) {
      score = 100;
    }
    // 3. Non-word-boundary containment (e.g. query appears mid-word)
    else if (entry.normalisedTitle.includes(normalisedQuery)) {
      score = 80;
    }

    // 4. Check full release name (word-boundary aware)
    if (score < 95) {
      const nameWords = (entry.item.name ?? '')
        .split(/[^a-zA-Z0-9]+/)
        .filter(Boolean)
        .map(normaliseTitle)
        .filter(Boolean);

      if (matchesAtWordBoundary(nameWords, normalisedQuery)) {
        score = Math.max(score, 95);
      } else {
        const normalisedName = normaliseTitle(entry.item.name ?? '');
        if (normalisedName.includes(normalisedQuery)) {
          score = Math.max(score, 80);
        }
      }
    }

    // 5. Fuzzy match on the parsed title (handles typos, reordering)
    if (score < 100) {
      let fuzzyScore = token_set_ratio(query, entry.parsedTitle);
      // Penalize fuzzy matches without word-level alignment
      if (!wordAligned) {
        fuzzyScore = Math.round(fuzzyScore * 0.6);
      }
      score = Math.max(score, fuzzyScore);
    }

    if (score >= SEARCH_FUZZY_THRESHOLD) {
      scored.push({ entry, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.entry);
}

function sortParsedItems(
  items: ParsedCatalogItem[],
  sort: CatalogSort,
  direction: 'asc' | 'desc'
): void {
  items.sort((a, b) => {
    let cmp = 0;
    if (sort === 'title') {
      cmp = a.parsedTitle.localeCompare(b.parsedTitle);
    } else {
      const aDate = a.item.addedAt ? new Date(a.item.addedAt).getTime() : 0;
      const bDate = b.item.addedAt ? new Date(b.item.addedAt).getTime() : 0;
      cmp = aDate - bDate;
    }
    return direction === 'desc' ? -cmp : cmp;
  });
}

function createMetaPreview(entry: ParsedCatalogItem): MetaPreview {
  const { item, parsed } = entry;
  const descriptionParts: string[] = [];

  if (item.size) descriptionParts.push(`📦 ${formatBytes(item.size, 1000)}`);
  if (item.addedAt) {
    descriptionParts.push(`📅 ${new Date(item.addedAt).toLocaleDateString()}`);
  }
  if (parsed.resolution) descriptionParts.push(`🖥️ ${parsed.resolution}`);
  const typeIcon = item.itemType === 'torrent' ? '🧲' : '📰';
  descriptionParts.push(`${typeIcon} ${item.itemType}`);

  return {
    id: `${LIBRARY_ID_PREFIX}${item.serviceId}.${item.itemType}.${item.id}`,
    type: 'library',
    name: item.name ?? 'Unknown',
    description: descriptionParts.join(' • '),
    posterShape: 'landscape',
  };
}

/**
 * Pre-warm library caches for all configured services.
 * Fire-and-forget: calls listMagnets/listNzbs which will populate the cache
 * on a cache miss or serve stale data while refreshing in the background.
 */
export function preWarmLibraryCaches(
  services: { id: BuiltinServiceId; credential: string }[],
  clientIp?: string,
  sources?: ('torrent' | 'nzb')[]
): void {
  const includeTorrents =
    !sources || sources.length === 0 || sources.includes('torrent');
  const includeNzbs =
    !sources || sources.length === 0 || sources.includes('nzb');

  for (const service of services) {
    const debridService = getDebridService(
      service.id,
      service.credential,
      clientIp
    );
    if (includeTorrents && isTorrentDebridService(debridService)) {
      debridService.listMagnets().catch((err: any) =>
        logger.debug(`Pre-warm listMagnets failed for ${service.id}`, {
          error: err?.message,
        })
      );
    }
    if (
      includeNzbs &&
      isUsenetDebridService(debridService) &&
      debridService.listNzbs
    ) {
      debridService.listNzbs().catch((err: any) =>
        logger.debug(`Pre-warm listNzbs failed for ${service.id}`, {
          error: err?.message,
        })
      );
    }
  }
}

/** Clears and re-fetches the library cache for a specific service. */
export async function refreshLibraryCacheForService(
  serviceId: BuiltinServiceId,
  serviceCredential: string,
  clientIp?: string,
  sources?: ('torrent' | 'nzb')[]
): Promise<void> {
  const debridService = getDebridService(
    serviceId,
    serviceCredential,
    clientIp
  );

  if (!debridService.refreshLibraryCache) {
    throw new Error(
      `Service ${serviceId} does not support refreshLibraryCache`
    );
  }

  await debridService.refreshLibraryCache(sources);
}
