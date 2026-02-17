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
import { parseTorrentTitle } from '@viren070/parse-torrent-title';

const logger = createLogger('library:catalog');

export const LIBRARY_ID_PREFIX = 'aiostreams::library.';
export const CATALOG_PAGE_SIZE = 100;

export type CatalogSort = 'added' | 'title';

export interface CatalogItem extends DebridDownload {
  serviceId: BuiltinServiceId;
  serviceCredential: string;
  itemType: 'torrent' | 'usenet';
}

export function buildIdPrefixes(
  services: { id: BuiltinServiceId }[]
): string[] {
  return services.map((service) => `${LIBRARY_ID_PREFIX}${service.id}`);
}

export function buildCatalogs(
  services: { id: BuiltinServiceId }[],
  sources?: ('torrent' | 'nzb')[]
): Manifest['catalogs'] {
  const catalogs: Manifest['catalogs'] = [];

  for (const service of services) {
    const serviceMeta = constants.SERVICE_DETAILS[service.id];
    catalogs.push({
      type: 'library',
      id: `${LIBRARY_ID_PREFIX}${service.id}`,
      name: `${serviceMeta.name}`,
      extra: [
        { name: 'skip' },
        {
          name: 'genre',
          options: ['Date Added ↓', 'Date Added ↑', 'Title A-Z', 'Title Z-A'],
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
  skip: number,
  sort: CatalogSort,
  sortDirection: 'asc' | 'desc',
  sources?: ('torrent' | 'nzb')[]
): Promise<MetaPreview[]> {
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

  sortItems(items, sort, sortDirection);
  const page = items.slice(skip, skip + CATALOG_PAGE_SIZE);

  return page.map((item) => createMetaPreview(item));
}

export function parseExtras(extras?: string): {
  skip: number;
  sort: CatalogSort;
  sortDirection: 'asc' | 'desc';
} {
  let skip = 0;
  let sort: CatalogSort = 'added';
  let sortDirection: 'asc' | 'desc' = 'desc';

  if (extras) {
    const params = Object.fromEntries(
      extras.split('&').map((e) => {
        const [key, ...rest] = e.split('=');
        return [key, decodeURIComponent(rest.join('='))];
      })
    );
    if (params.skip) skip = parseInt(params.skip, 10) || 0;
    if (params.genre) {
      const genre = params.genre;
      if (genre.includes('Title')) {
        sort = 'title';
        sortDirection = genre.includes('Z-A') ? 'desc' : 'asc';
      } else {
        sort = 'added';
        sortDirection = genre.includes('↑') ? 'asc' : 'desc';
      }
    }
  }

  return { skip, sort, sortDirection };
}

function sortItems(
  items: CatalogItem[],
  sort: CatalogSort,
  direction: 'asc' | 'desc'
): void {
  items.sort((a, b) => {
    let cmp = 0;
    if (sort === 'title') {
      cmp = (a.name ?? '').localeCompare(b.name ?? '');
    } else {
      const aDate = a.addedAt ? new Date(a.addedAt).getTime() : 0;
      const bDate = b.addedAt ? new Date(b.addedAt).getTime() : 0;
      cmp = aDate - bDate;
    }
    return direction === 'desc' ? -cmp : cmp;
  });
}

function createMetaPreview(item: CatalogItem): MetaPreview {
  const parsed = parseTorrentTitle(item.name ?? '');
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
