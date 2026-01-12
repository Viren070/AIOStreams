import {
  BaseDebridAddon,
  BaseDebridConfigSchema,
  SearchMetadata,
} from '../base/debrid.js';
import { z } from 'zod';
import {
  createLogger,
  getTimeTakenSincePoint,
  ParsedId,
  AnimeDatabase,
} from '../../utils/index.js';
import SeaDexAPI from './api.js';
import { NZB, UnprocessedTorrent } from '../../debrid/utils.js';
import { validateInfoHash } from '../utils/debrid.js';

const logger = createLogger('seadex');

export const SeaDexAddonConfigSchema = BaseDebridConfigSchema;

export type SeaDexAddonConfig = z.infer<typeof SeaDexAddonConfigSchema>;

export class SeaDexAddon extends BaseDebridAddon<SeaDexAddonConfig> {
  readonly id = 'seadex';
  readonly name = 'SeaDex';
  readonly version = '1.0.0';
  readonly logger = logger;
  readonly api: SeaDexAPI;

  constructor(userData: SeaDexAddonConfig, clientIp?: string) {
    super(userData, SeaDexAddonConfigSchema, clientIp);
    this.api = new SeaDexAPI();
  }

  protected async _searchNzbs(
    parsedId: ParsedId,
    metadata: SearchMetadata
  ): Promise<NZB[]> {
    return [];
  }

  protected async _searchTorrents(
    parsedId: ParsedId,
    metadata: SearchMetadata
  ): Promise<UnprocessedTorrent[]> {
    // SeaDex only works with anime
    if (!metadata.isAnime) {
      logger.debug(`SeaDex skipped: not anime content`);
      return [];
    }

    const start = Date.now();

    // Get AniList ID from the anime database
    const animeDb = AnimeDatabase.getInstance();
    const season = parsedId.season ? Number(parsedId.season) : undefined;
    const episode = parsedId.episode ? Number(parsedId.episode) : undefined;
    const animeEntry = animeDb.getEntryById(
      parsedId.type,
      parsedId.value,
      season,
      episode
    );

    const anilistId = animeEntry?.mappings?.anilistId
      ? Number(animeEntry.mappings.anilistId)
      : undefined;

    if (!anilistId) {
      logger.debug(
        `No AniList ID found for ${parsedId.type}:${parsedId.value}`
      );
      return [];
    }

    logger.info(`Performing SeaDex search for AniList ID ${anilistId}`);

    try {
      const response = await this.api.getEntriesByAnilistId(anilistId);

      const items = response.items;
      if (!items || items.length === 0) {
        logger.debug(`No SeaDex entries found for AniList ID ${anilistId}`);
        return [];
      }

      const seenTorrents = new Set<string>();
      const torrents: UnprocessedTorrent[] = [];
      let redactedCount = 0;

      for (const item of items) {
        const trsArray = item.expand?.trs;
        if (!trsArray) continue;

        for (const torrent of trsArray) {
          const infoHash = torrent.infoHash?.toLowerCase();

          // Handle redacted hashes
          if (!infoHash || infoHash.includes('<redacted>') || infoHash === '') {
            redactedCount++;
            logger.debug(
              `Skipping redacted/empty hash from ${torrent.tracker} (${torrent.releaseGroup || 'unknown group'})`
            );
            continue;
          }

          const hash = validateInfoHash(infoHash);
          if (!hash) {
            logger.warn(`Invalid info hash in SeaDex data: ${infoHash}`);
            continue;
          }

          if (seenTorrents.has(hash)) {
            continue;
          }
          seenTorrents.add(hash);

          // Calculate file size from files array
          const totalSize =
            torrent.files?.reduce((sum, file) => sum + file.length, 0) ?? 0;

          torrents.push({
            confirmed: true,
            hash,
            group: torrent.releaseGroup,
            indexer: torrent.tracker,
            sources:
              torrent.tracker === 'Nyaa'
                ? [
                    'http://nyaa.tracker.wf:7777/announce',
                    'udp://open.stealth.si:80/announce',
                    'udp://tracker.opentrackr.org:1337/announce',
                    'udp://exodus.desync.com:6969/announce',
                    'udp://tracker.torrent.eu.org:451/announce',
                  ]
                : [],
            size: totalSize,
            type: 'torrent',
          });
        }
      }

      if (redactedCount > 0) {
        logger.info(
          `Skipped ${redactedCount} redacted/empty hashes for AniList ID ${anilistId}`
        );
      }

      logger.info(
        `SeaDex search for AniList ID ${anilistId} took ${getTimeTakenSincePoint(start)}`,
        {
          results: torrents.length,
          redacted: redactedCount,
        }
      );

      return torrents;
    } catch (error) {
      logger.error(
        `SeaDex search failed for AniList ID ${anilistId}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      return [];
    }
  }
}
