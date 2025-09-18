import { z } from 'zod';
import { Manifest, Stream } from '../../db/index.js';
import {
  AnimeDatabase,
  createLogger,
  formatZodError,
  getTimeTakenSincePoint,
} from '../../utils/index.js';
import { TorBoxSearchAddonUserDataSchema } from './schemas.js';
import { TorboxApi } from '@torbox/torbox-api';
import TorboxSearchApi from './search-api.js';
import { IdParser } from '../../utils/id-parser.js';
import {
  TorrentSourceHandler,
  UsenetSourceHandler,
} from './source-handlers.js';
import { TorBoxSearchAddonError } from './errors.js';
import { supportedIdTypes } from './search-api.js';

const logger = createLogger('torbox-search');

export class TorBoxSearchAddon {
  private readonly userData: z.infer<typeof TorBoxSearchAddonUserDataSchema>;
  private readonly searchApi: TorboxSearchApi;
  private readonly torboxApi: TorboxApi;
  private readonly sourceHandlers: (
    | TorrentSourceHandler
    | UsenetSourceHandler
  )[];
  private readonly manifest: Manifest;

  constructor(
    userData: z.infer<typeof TorBoxSearchAddonUserDataSchema>,
    private readonly clientIp?: string
  ) {
    this.userData = this.validateUserData(userData);
    this.manifest = TorBoxSearchAddon.getManifest();

    this.searchApi = new TorboxSearchApi(this.userData.torBoxApiKey);
    this.torboxApi = new TorboxApi({ token: this.userData.torBoxApiKey });

    this.sourceHandlers = this.initializeSourceHandlers();
  }

  private validateUserData(
    userData: unknown
  ): z.infer<typeof TorBoxSearchAddonUserDataSchema> {
    const { success, data, error } =
      TorBoxSearchAddonUserDataSchema.safeParse(userData);
    if (!success) {
      throw new TorBoxSearchAddonError(
        `Invalid user data: ${formatZodError(error)}`,
        400
      );
    }
    if (
      data.sources.includes('usenet') &&
      !data.services.some((service) => service.id === 'torbox')
    ) {
      data.sources = data.sources.filter((source) => source !== 'usenet');
    }
    return data;
  }

  static getManifest(): Manifest {
    return {
      id: 'com.torbox-search.viren070',
      name: 'TorBox Search',
      description: 'Search for torrents and usenet on TorBox',
      version: '1.0.0',
      types: ['movie', 'series', 'anime'],
      resources: [
        {
          name: 'stream',
          types: ['movie', 'series', 'anime'],
          idPrefixes: IdParser.getPrefixes(supportedIdTypes),
        },
      ],
      catalogs: [],
    };
  }

  private initializeSourceHandlers(): (
    | TorrentSourceHandler
    | UsenetSourceHandler
  )[] {
    const handlers = [];
    if (this.userData.sources.includes('torrent')) {
      handlers.push(
        new TorrentSourceHandler(
          this.searchApi,
          this.userData.services,
          this.userData.searchUserEngines,
          this.clientIp
        )
      );
    }
    if (this.userData.sources.includes('usenet')) {
      handlers.push(
        new UsenetSourceHandler(
          this.searchApi,
          this.torboxApi,
          this.userData.searchUserEngines,
          this.userData.services,
          this.clientIp
        )
      );
    }
    return handlers;
  }

  public getManifest(): Manifest {
    return this.manifest;
  }

  public async getStreams(type: string, id: string): Promise<Stream[]> {
    const parsedId = IdParser.parse(id, type);
    if (!parsedId || !supportedIdTypes.includes(parsedId.type)) {
      throw new TorBoxSearchAddonError(`Unsupported ID: ${id}`, 400);
    }

    const animeEntry = AnimeDatabase.getInstance().getEntryById(
      parsedId.type,
      parsedId.value
    );
    if (animeEntry && !parsedId.season) {
      parsedId.season =
        animeEntry.imdb?.fromImdbSeason?.toString() ??
        animeEntry.trakt?.season?.toString();
      logger.debug(`Updated season for ${id} to ${parsedId.season}`);
    }

    logger.info(`Handling stream request`, {
      type,
      id,
      idType: parsedId.type,
      idValue: parsedId.value,
      season: parsedId.season,
      episode: parsedId.episode,
      sources: this.userData.sources,
    });

    const start = Date.now();
    const streamPromises = this.sourceHandlers.map((handler) =>
      handler.getStreams(parsedId, this.userData).catch((error) => {
        return [];
      })
    );

    const results = await Promise.all(streamPromises);
    const streams = results.flat();

    // filter out duplicate error streams and merge them
    const errorStreams = streams.filter((stream) =>
      stream.name?.startsWith('[❌')
    );

    const uniqueErrorStreams = errorStreams.filter(
      (stream, index, self) =>
        index === self.findIndex((t) => t.description === stream.description)
    );

    const mergedErrorStreams = uniqueErrorStreams.reduce<Stream[]>(
      (acc, stream) => {
        const existing = acc.find((s) => s.description === stream.description);
        if (existing) {
          existing.name += `\n${stream.name?.replace('[❌', '')}`;
        } else {
          acc.push(stream);
        }
        return acc;
      },
      []
    );

    const filteredStreams = streams.filter(
      (stream) => !stream.name?.startsWith('[❌')
    );
    const finalStreams = [...filteredStreams, ...mergedErrorStreams];

    logger.info(
      `Created ${finalStreams.length} streams for ${id} in ${getTimeTakenSincePoint(start)}`
    );
    return finalStreams;
  }
}
