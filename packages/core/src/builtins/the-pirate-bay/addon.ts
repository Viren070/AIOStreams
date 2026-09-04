import { BaseDebridAddon, BaseDebridConfigSchema } from '../base/debrid.js';
import { z } from 'zod';
import { createLogger, ParsedId } from '../../utils/index.js';
import ThePirateBayAPI, { getThePirateBayUrl } from './api.js';
import { NZB, UnprocessedTorrent } from '../../debrid/utils.js';
import { validateInfoHash } from '../utils/debrid.js';
import { createQueryLimit, getTitleLanguagesForUrl } from '../utils/general.js';

const logger = createLogger('the-pirate-bay');

export const ThePirateBayAddonConfigSchema = BaseDebridConfigSchema;

export type ThePirateBayAddonConfig = z.infer<
  typeof ThePirateBayAddonConfigSchema
>;

export class ThePirateBayAddon extends BaseDebridAddon<ThePirateBayAddonConfig> {
  readonly id = 'the-pirate-bay';
  readonly name = 'The Pirate Bay';
  readonly version = '1.0.0';
  readonly logger = logger;
  readonly api: ThePirateBayAPI;

  constructor(userData: ThePirateBayAddonConfig, clientIp?: string) {
    super(userData, ThePirateBayAddonConfigSchema, clientIp);
    this.api = new ThePirateBayAPI();
  }

  protected async _searchNzbs(_parsedId: ParsedId): Promise<NZB[]> {
    return [];
  }

  protected async _searchTorrents(
    parsedId: ParsedId
  ): Promise<UnprocessedTorrent[]> {
    const queryLimit = createQueryLimit();
    const metadata = await this.getSearchMetadata();
    if (!metadata.primaryTitle) {
      return [];
    }

    const queries = this.buildQueries(parsedId, metadata, {
      titleLanguages: getTitleLanguagesForUrl(getThePirateBayUrl(), this.id),
    });
    if (metadata.imdbId) {
      queries.push(metadata.imdbId);
    }

    if (queries.length === 0) {
      return [];
    }

    logger.info(`Performing The Pirate Bay search`, { queries });

    const searchPromises = queries.map((q) =>
      queryLimit(() => this.api.search(q))
    );
    const allResults = (await Promise.all(searchPromises))
      .flat()
      .filter(
        (result) =>
          !result.imdbId ||
          !metadata.imdbId ||
          result.imdbId === metadata.imdbId
      );

    const seenTorrents = new Set<string>();
    const torrents: UnprocessedTorrent[] = [];
    for (const result of allResults) {
      const hash = validateInfoHash(result.hash);
      if (!hash) {
        logger.warn(
          `The Pirate Bay search hit has no valid hash: ${JSON.stringify(result)}`
        );
        continue;
      }
      if (seenTorrents.has(hash)) {
        continue;
      }
      seenTorrents.add(hash);

      const age = Math.ceil(
        (Date.now() - result.added * 1000) / (1000 * 60 * 60)
      );

      torrents.push({
        hash,
        sources: [],
        indexer: `TPB | ${result.user}`,
        seeders: result.seeders,
        age,
        title: result.name,
        size: result.size,
        type: 'torrent',
      });
    }
    return torrents;
  }
}
