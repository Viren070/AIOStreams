/**
 * Easynews Search Addon
 *
 * Provides NZB search results from Easynews for usenet-based debrid services.
 */

import { z } from 'zod';
import { ParsedId } from '../../utils/id-parser.js';
import {
  constants,
  createLogger,
  Env,
  getTimeTakenSincePoint,
} from '../../utils/index.js';
import { NZB, Torrent } from '../../debrid/index.js';
import {
  BaseDebridAddon,
  BaseDebridConfigSchema,
  SearchMetadata,
} from '../base/debrid.js';
import { createQueryLimit, useAllTitles } from '../utils/general.js';
import { createHash } from 'crypto';
import EasynewsApi, {
  EasynewsApiError,
  EasynewsSearchItem,
  EasynewsSearchResult,
  EasynewsAuthSchema,
  EASYNEWS_BASE,
} from './api.js';
import { BuiltinProxy } from '../../proxy/builtin.js';

const logger = createLogger('easynews');

export const EasynewsSearchAddonConfigSchema = BaseDebridConfigSchema.extend({
  authentication: z.string(),
  paginate: z.boolean().default(false),
  aiostreamsAuth: z.string().optional(), // Optional AIOStreams auth for rate limit bypass
});

export type EasynewsSearchAddonConfig = z.infer<
  typeof EasynewsSearchAddonConfigSchema
>;

/**
 * Easynews Search built-in addon
 */
export class EasynewsSearchAddon extends BaseDebridAddon<EasynewsSearchAddonConfig> {
  readonly id = 'easynews';
  readonly name = 'Easynews';
  readonly version = '1.0.0';
  readonly logger = logger;
  readonly auth: z.infer<typeof EasynewsAuthSchema>;
  readonly api: EasynewsApi;
  readonly encodedAiostreamsAuth?: string;

  constructor(config: EasynewsSearchAddonConfig, clientIp?: string) {
    super(config, EasynewsSearchAddonConfigSchema, clientIp);

    // Pre-encode aiostreamsAuth if provided (for static URLs)
    if (config.aiostreamsAuth) {
      this.encodedAiostreamsAuth = Buffer.from(config.aiostreamsAuth).toString(
        'base64url'
      );
    }

    if (
      config.services.some(
        (s) =>
          ![
            constants.TORBOX_SERVICE,
            constants.NZBDAV_SERVICE,
            constants.ALTMOUNT_SERVICE,
            constants.STREMIO_NNTP_SERVICE,
            constants.EASYNEWS_SERVICE,
          ].includes(s.id)
      )
    ) {
      throw new Error(
        'The Easynews addon only supports TorBox, NZB DAV, Altmount, Easynews, and Stremio NNTP services'
      );
    }

    const auth = EasynewsAuthSchema.parse(
      JSON.parse(Buffer.from(config.authentication, 'base64').toString())
    );
    this.auth = auth;

    this.api = new EasynewsApi(auth.username, auth.password);
  }

  protected async _searchNzbs(parsedId: ParsedId): Promise<NZB[]> {
    // validate aiostreams auth if provided
    if (this.userData.aiostreamsAuth) {
      try {
        BuiltinProxy.validateAuth(this.userData.aiostreamsAuth);
      } catch (error) {
        throw new Error('Invalid AIOStreams Auth.');
      }
    }
    const queryLimit = createQueryLimit();

    const metadata = await this.getSearchMetadata();
    if (!metadata.primaryTitle) {
      return [];
    }

    const queries = this.buildQueries(parsedId, metadata, {
      addYear: parsedId.mediaType === 'movie',
      addSeasonEpisode: parsedId.mediaType === 'series',
      useAllTitles: useAllTitles(EASYNEWS_BASE),
    });

    if (queries.length === 0) {
      return [];
    }

    logger.info(`Performing Easynews search`, { queries });

    const searchPromises = queries.map((query) =>
      queryLimit(async () => {
        const start = Date.now();
        try {
          const result = await this.api.search({
            query,
            paginate: this.userData.paginate,
          });
          logger.info(
            `Easynews search for "${query}" took ${getTimeTakenSincePoint(start)}`,
            { results: result.results.length }
          );
          return result;
        } catch (error) {
          if (error instanceof EasynewsApiError) {
            if (error.status === 401) {
              throw error;
            }
            logger.error(`Easynews API error: ${error.message}`, {
              status: error.status,
            });
          } else {
            logger.error(
              `Easynews search error: ${error instanceof Error ? error.message : String(error)}`
            );
          }
          return null;
        }
      })
    );

    const allResults = await Promise.all(searchPromises);

    const validResults = allResults.filter(
      (r): r is EasynewsSearchResult => r !== null
    );

    if (validResults.length === 0) {
      return [];
    }

    // use download info from first successful result
    const downloadInfo = validResults[0].downloadInfo;

    const items = validResults.flatMap((r) => r.results);

    // Deduplicate by hash
    const seenHashes = new Set<string>();
    const uniqueItems: EasynewsSearchItem[] = [];
    for (const item of items) {
      if (!seenHashes.has(item.hash)) {
        seenHashes.add(item.hash);
        uniqueItems.push(item);
      }
    }

    // convert to NZB format
    const nzbs: NZB[] = uniqueItems.map((item) => {
      const nzbUrl = this.api.generateNzbUrl(
        item,
        Env.BASE_URL,
        this.encodedAiostreamsAuth
      );
      const age = this.api.calculateAge(item.posted);
      const easynewsUrl = this.api.generateEasynewsDlUrl(item, downloadInfo);

      return {
        confirmed: false,
        hash: createHash('md5').update(nzbUrl).digest('hex'),
        nzb: nzbUrl,
        easynewsUrl,
        age,
        title: item.title,
        indexer: 'Easynews',
        size: item.size,
        type: 'usenet',
        duration: item.duration,
      };
    });

    logger.info(`Found ${nzbs.length} unique NZBs from Easynews`, {
      downloadInfo,
    });
    return nzbs;
  }

  /**
   * Search for torrents - not applicable for Easynews
   */
  protected async _searchTorrents(parsedId: ParsedId): Promise<Torrent[]> {
    return [];
  }
}

export default EasynewsSearchAddon;
