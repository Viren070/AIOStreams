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
} from '../../utils/index.js';
import EztvAPI from './api.js';
import { NZB, UnprocessedTorrent } from '../../debrid/utils.js';
import {
  extractInfoHashFromMagnet,
  extractTrackersFromMagnet,
  validateInfoHash,
} from '../utils/debrid.js';

const logger = createLogger('eztv');

export const EztvAddonConfigSchema = BaseDebridConfigSchema;

export type EztvAddonConfig = z.infer<typeof EztvAddonConfigSchema>;

/**
 * EZTV only supports TV series and can only be searched by IMDB ID.
 * Returns empty for movies and when IMDB ID or season/episode are missing.
 */
export class EztvAddon extends BaseDebridAddon<EztvAddonConfig> {
  readonly id = 'eztv';
  readonly name = 'EZTV';
  readonly version = '1.0.0';
  readonly logger = logger;
  readonly api: EztvAPI;

  constructor(userData: EztvAddonConfig, clientIp?: string) {
    super(userData, EztvAddonConfigSchema, clientIp);
    this.api = new EztvAPI();
  }

  protected async _searchNzbs(
    _parsedId: ParsedId,
    _metadata: SearchMetadata
  ): Promise<NZB[]> {
    return [];
  }

  protected async _searchTorrents(
    parsedId: ParsedId,
    metadata: SearchMetadata
  ): Promise<UnprocessedTorrent[]> {
    if (parsedId.mediaType !== 'series') {
      logger.debug('EZTV only supports TV series, skipping for non-series');
      return [];
    }

    const imdbId =
      metadata.imdbId ??
      (parsedId.type === 'imdbId' ? `tt${parsedId.value}` : undefined);
    if (!imdbId) {
      logger.debug('EZTV requires IMDB ID, skipping');
      return [];
    }

    const imdbIdWithoutTt = imdbId.replace(/^tt/i, '');
    const requestedSeason =
      metadata.season ??
      (parsedId.season ? Number(parsedId.season) : undefined);
    const requestedEpisode =
      metadata.episode ??
      (parsedId.episode ? Number(parsedId.episode) : undefined);

    if (requestedSeason === undefined || requestedEpisode === undefined) {
      logger.debug('EZTV requires season and episode for series, skipping');
      return [];
    }

    logger.info(`Performing EZTV search`, {
      imdbId: imdbIdWithoutTt,
      season: requestedSeason,
      episode: requestedEpisode,
    });

    const start = Date.now();
    let response;
    try {
      response = await this.api.getTorrents({
        imdbId: imdbIdWithoutTt,
        limit: 100,
      });
    } catch (error) {
      logger.error(
        `EZTV API request failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      return [];
    }

    const seasonStr = String(requestedSeason);
    const episodeStr = String(requestedEpisode);

    const matchingTorrents = response.torrents.filter(
      (t) => t.season === seasonStr && t.episode === episodeStr
    );

    logger.info(`EZTV search took ${getTimeTakenSincePoint(start)}`, {
      total: response.torrents.length,
      matching: matchingTorrents.length,
    });

    const seenTorrents = new Set<string>();
    const torrents: UnprocessedTorrent[] = [];

    for (const t of matchingTorrents) {
      const hash = validateInfoHash(
        t.hash ||
          (t.magnetUrl ? extractInfoHashFromMagnet(t.magnetUrl) : undefined)
      );
      if (!hash) {
        logger.warn(`EZTV torrent has no valid hash: ${t.filename}`);
        continue;
      }
      if (seenTorrents.has(hash)) {
        continue;
      }
      seenTorrents.add(hash);

      const sources = t.magnetUrl
        ? extractTrackersFromMagnet(t.magnetUrl)
        : [];
      const sizeBytes = parseInt(t.sizeBytes, 10);
      const age = t.dateReleasedUnix
        ? Math.ceil((Date.now() / 1000 - t.dateReleasedUnix) / 3600)
        : undefined;

      torrents.push({
        hash,
        downloadUrl: undefined,
        sources,
        indexer: 'EZTV',
        seeders: t.seeds,
        title: t.title || t.filename,
        size: Number.isNaN(sizeBytes) ? 0 : sizeBytes,
        age,
        type: 'torrent',
      });
    }

    return torrents;
  }
}
