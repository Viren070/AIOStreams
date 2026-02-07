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
import { SeaDexDataset } from './dataset.js';
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
  readonly dataset: SeaDexDataset;

  constructor(userData: SeaDexAddonConfig, clientIp?: string) {
    super(userData, SeaDexAddonConfigSchema, clientIp);
    this.dataset = SeaDexDataset.getInstance();
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
    try {
      await this.dataset.initialise();
    } catch (error) {
      throw new Error(
        `SeaDex dataset was not initialised: ${error instanceof Error ? error.message : String(error)}`
      );
    }

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
      const torrentsList = this.dataset.getTorrents(anilistId);

      if (torrentsList.length === 0) {
        logger.debug(`No SeaDex entries found for AniList ID ${anilistId}`);
        return [];
      }

      const seenTorrents = new Set<string>();
      const torrents: UnprocessedTorrent[] = [];
      let redactedCount = 0;

      for (const torrent of torrentsList) {
        const infoHash = torrent.infoHash;

        // Handle redacted hashes
        if (!infoHash || infoHash.includes('<redacted>') || infoHash === '') {
          redactedCount++;
          continue;
        }

        if (seenTorrents.has(infoHash)) {
          continue;
        }
        seenTorrents.add(infoHash);

        if (!validateInfoHash(infoHash)) {
          continue;
        }

        const totalSize = torrent.files.reduce(
          (sum, file) => sum + file.length,
          0
        );

        const created = torrent.created ? new Date(torrent.created) : undefined;
        const age = created
          ? Math.floor((Date.now() - created.getTime()) / 3600000)
          : undefined;

        torrents.push({
          confirmed: true,
          hash: infoHash,
          group: torrent.releaseGroup,
          age,
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

      logger.info(
        `Found ${torrents.length} SeaDex torrents for AniList ID ${anilistId}${
          redactedCount > 0 ? ` (skipped ${redactedCount} redacted)` : ''
        } in ${getTimeTakenSincePoint(start)}`
      );

      return torrents;
    } catch (error) {
      logger.error(
        `Failed to search SeaDex for AniList ID ${anilistId}:`,
        error
      );
      return [];
    }
  }
}
