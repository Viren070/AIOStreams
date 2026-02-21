import {
  BuiltinServiceId,
  constants,
  createLogger,
} from '../../utils/index.js';
import {
  DebridDownload,
  DebridFile,
  getDebridService,
  isTorrentDebridService,
  isUsenetDebridService,
  isVideoFile,
} from '../../debrid/index.js';
import { Meta } from '../../db/schemas.js';
import { formatSmartBytes } from '../../formatters/utils.js';
import { parseTorrentTitle } from '@viren070/parse-torrent-title';
import { LIBRARY_ID_PREFIX } from './catalog.js';

const logger = createLogger('library:meta');

/**
 * Parses a library meta/stream ID into its component parts.
 *
 * ID format: `${LIBRARY_ID_PREFIX}<serviceId>.<itemType>.<itemId>`
 * The prefix uses dots internally, so the first segment after splitting
 * by '.' is the prefix (without dots), followed by serviceId, itemType, itemId...
 */
export function parseLibraryId(id: string): {
  serviceId: BuiltinServiceId;
  itemType: 'torrent' | 'usenet' | 'action';
  itemId: string;
} {
  const parts = id.split('.');
  if (parts.length < 4 || parts[0] !== LIBRARY_ID_PREFIX.replace(/\./g, '')) {
    throw new Error(`Invalid library ID: ${id}`);
  }

  return {
    serviceId: parts[1] as BuiltinServiceId,
    itemType: parts[2] as 'torrent' | 'usenet' | 'action',
    itemId: parts.slice(3).join('.'),
  };
}

export async function fetchItem(
  serviceId: BuiltinServiceId,
  serviceCredential: string,
  itemType: 'torrent' | 'usenet',
  itemId: string,
  clientIp?: string
): Promise<DebridDownload> {
  const debridService = getDebridService(
    serviceId,
    serviceCredential,
    clientIp
  );

  if (itemType === 'torrent') {
    if (!isTorrentDebridService(debridService) || !debridService.getMagnet) {
      throw new Error(`Service ${serviceId} does not support getMagnet`);
    }
    return debridService.getMagnet(itemId);
  }

  if (!isUsenetDebridService(debridService)) {
    throw new Error(`Service ${serviceId} does not support usenet`);
  }

  if (debridService.getNzb) {
    return debridService.getNzb(itemId);
  }

  if (debridService.listNzbs) {
    const nzbs = await debridService.listNzbs();
    const found = nzbs.find(
      (n: DebridDownload) => n.id.toString() === itemId || n.name === itemId
    );
    if (!found) {
      logger.warn(`NZB item ${itemId} not found in service ${serviceId}`, {
        itemId,
        serviceId,
      });
      throw new Error(`NZB item ${itemId} not found`);
    }
    return found;
  }

  throw new Error(`Service ${serviceId} does not support getNzb or listNzbs`);
}

export function buildMeta(
  id: string,
  item: DebridDownload,
  service: { id: BuiltinServiceId; credential: string },
  itemType: 'torrent' | 'usenet'
): Meta {
  const videos = buildVideos(item, id);
  const parsed = parseTorrentTitle(item.name ?? '');
  const descriptionParts: string[] = [];

  const padNumber = (num: number) => num.toString().padStart(2, '0');

  if (parsed.title) descriptionParts.push(`✏️ ${parsed.title}`);
  if (parsed.year) descriptionParts.push(`📅 ${parsed.year}`);
  if (parsed.seasons && parsed.seasons.length > 0) {
    const seasonStr =
      parsed.seasons.length > 1
        ? `S${padNumber(parsed.seasons[0])}-${padNumber(parsed.seasons.slice(-1)[0])}`
        : `S${padNumber(parsed.seasons[0])}`;
    descriptionParts.push(`📺 ${seasonStr}`);
  }
  if (parsed.episodes && parsed.episodes.length > 0) {
    const episodeStr =
      parsed.episodes.length > 1
        ? `E${padNumber(parsed.episodes[0])}-${padNumber(parsed.episodes.slice(-1)[0])}`
        : `E${padNumber(parsed.episodes[0])}`;
    descriptionParts.push(`🎞️ ${episodeStr}`);
  }
  if (item.size)
    descriptionParts.push(`📦 ${formatSmartBytes(item.size, 1000)}`);
  if (item.addedAt) {
    descriptionParts.push(`📅 ${new Date(item.addedAt).toLocaleDateString()}`);
  }
  if (item.files?.length) {
    descriptionParts.push(`📁 ${item.files.length} files`);
  }
  if (parsed.resolution) {
    descriptionParts.push(`🖥️ ${parsed.resolution}`);
  }

  return {
    id,
    name: item.name ?? 'Unknown',
    type: 'library',
    description: descriptionParts.join(' • '),
    posterShape: 'landscape',
    videos,
    behaviorHints: {
      defaultVideoId: videos.length === 1 ? videos[0].id : undefined,
    },
  };
}

/**
 * Builds video entries for a library item's files.
 */
function buildVideos(
  item: DebridDownload,
  metaId: string
): Meta['videos'] & object {
  const files = item.files ?? [];
  const videoFiles = files.filter(
    (file) => isVideoFile(file) && file.name && file.size > 0
  );

  if (videoFiles.length === 0) {
    return [
      {
        id: `${metaId}:default`,
        title: item.name ?? 'Play',
      },
    ];
  }

  return videoFiles.map((file) => {
    const parsed = parseTorrentTitle(file.name ?? '');

    const isSpecial =
      /NCED|NCOP/i.test(file.name ?? '') ||
      (parsed.releaseTypes?.length ?? 0) > 0;

    const fileId =
      file.index !== undefined && file.index !== -1
        ? file.index
        : (file.id ?? file.name);

    return {
      id: `${metaId}:${fileId}`,
      title: file.name,
      season: isSpecial
        ? 0
        : parsed.seasons && parsed.seasons.length > 0
          ? parsed.seasons[0]
          : parsed.episodes && parsed.episodes.length > 0
            ? parsed.year
              ? Number(parsed.year)
              : 1
            : 0,
      episode:
        parsed.episodes && parsed.episodes.length > 0 ? parsed.episodes[0] : 0,
    };
  });
}
