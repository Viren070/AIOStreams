import {
  Manifest,
  Meta,
  MetaPreview,
  Stream,
  Subtitle,
} from '../../db/index.js';
import {
  AnimeDatabase,
  Env,
  ExtrasParser,
  createLogger,
} from '../../utils/index.js';
import {
  GDriveAPI,
  GoogleOAuth,
  GoogleOAuthError,
  GoogleOAuthErrorCode,
} from './api.js';
import { GDriveFile, UserData } from './schemas.js';
import { IMDBMetadata } from '../../metadata/imdb.js';
import { TMDBMetadata } from '../../metadata/tmdb.js';
import { formatBytes, formatDuration } from '../../formatters/index.js';
import { IdParser, ParsedId } from '../../utils/id-parser.js';
import { IdType } from '../../utils/id-parser.js';
import { getTraktAliases } from '../../metadata/trakt.js';

const logger = createLogger('gdrive');

export class GDriveAddon {
  private userData: UserData;
  private api: GDriveAPI;
  private oauth: GoogleOAuth;
  private manifest: Manifest;
  private static readonly supportedIdTypes: IdType[] = [
    'imdbId',
    'themoviedbId',
    'thetvdbId',
    'kitsuId',
    'malId',
  ];

  constructor(userData: UserData) {
    this.userData = UserData.parse(userData);
    this.manifest = GDriveAddon.getManifest();
    this.manifest.behaviorHints = {
      ...this.manifest.behaviorHints,
      configurationRequired: false,
    };

    if (this.userData.metadataSource === 'imdb') {
      const streamResource = this.manifest.resources.find(
        (resource) => typeof resource !== 'string' && resource.name === 'stream'
      );
      if (streamResource && typeof streamResource !== 'string') {
        streamResource.idPrefixes = streamResource.idPrefixes!.filter(
          (prefix) => prefix !== 'tmdb' && prefix !== 'tvdb'
        );
      }
    }

    this.oauth = new GoogleOAuth(this.userData.refreshToken);
    this.api = new GDriveAPI(this.oauth);
  }

  private getMimeTypes() {
    const mimeTypes = ['video/'];
    if (this.userData.includeAudioFiles) {
      mimeTypes.push('audio/');
    }
    return mimeTypes;
  }

  static getManifest(): Manifest {
    return {
      id: 'com.gdrive.viren070',
      version: '1.0.0',
      name: 'Stremio GDrive',
      description: 'Stream your files from Google Drive within Stremio!',
      catalogs: [
        {
          name: 'Google Drive',
          id: 'gdrive.videos',
          type: 'movie',
          extra: [
            {
              name: 'search',
              isRequired: false,
            },
            {
              name: 'skip',
            },
          ],
        },
      ],
      resources: [
        {
          name: 'stream',
          types: ['movie', 'series', 'anime'],
          idPrefixes: IdParser.getPrefixes(GDriveAddon.supportedIdTypes),
        },
        {
          name: 'catalog',
          types: ['movie'],
          idPrefixes: ['gdrive'],
        },
        {
          name: 'meta',
          types: ['movie'],
          idPrefixes: ['gdrive'],
        },
      ],
      types: ['movie', 'series', 'anime'],
      behaviorHints: {
        adult: false,
        p2p: false,
        configurable: true,
        configurationRequired: true,
      },
    };
  }

  public getManifest(): Manifest {
    return this.manifest;
  }

  public async getStreams(type: string, id: string): Promise<Stream[]> {
    const parsedId = IdParser.parse(id, type);
    if (!parsedId || !GDriveAddon.supportedIdTypes.includes(parsedId.type)) {
      throw new Error(`Requested ID ${id} is not a valid or supported ID`);
    }
    logger.debug(`Parsed ID: ${id}`, parsedId);
    const { value: idValue, type: idType, season, episode } = parsedId;
    let searchQuery: string;
    try {
      const { titles, year } = await this.getMetadata(parsedId, type);
      searchQuery = this.buildSearchQuery(titles, year, season, episode);
      logger.debug(`Search query: ${searchQuery}`);
    } catch (error) {
      logger.error(
        `Failed to get metadata for ${idType}:${idValue}: ${error instanceof Error ? error.message : error}`
      );
      throw new Error('Failed to get metadata');
    }

    const queryParams = {
      q: searchQuery,
      corpora: 'allDrives',
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      pageSize: Env.BUILTIN_GDRIVE_PAGE_SIZE_LIMIT,
      fields:
        'files(id,name,description,size,createdTime,modifiedTime,thumbnailLink,iconLink,videoMediaMetadata,fileExtension)',
    };
    try {
      const { files } = await this.api.listFiles(queryParams);
      const accessToken = await this.oauth.getAccessToken();
      return files.map((file) => this.createStream(file, accessToken));
    } catch (error) {
      if (error instanceof GoogleOAuthError) {
        logger.error(
          `Google OAuth Error during stream retrieval: ${error.errorCode} - ${error.errorDescription}`
        );
        switch (error.errorCode) {
          case GoogleOAuthErrorCode.INVALID_GRANT:
            return [this.createErrorStream(`Invalid Refresh Token`)];
          case GoogleOAuthErrorCode.UNAUTHORIZED_CLIENT:
          case GoogleOAuthErrorCode.INVALID_CLIENT:
            return [this.createErrorStream(`Invalid Client ID or Secret`)];
          default:
            throw error;
        }
      }
      throw error;
    }
  }

  private createErrorStream(message: string): Stream {
    return {
      name: `[❌] Stremio GDrive`,
      description: message,
      url: 'stremio://',
    };
  }

  private async getMetadata(parsedId: ParsedId, type: string) {
    let titles: string[];
    let year: number | undefined;

    switch (true) {
      case parsedId.type === 'malId':
      case parsedId.type === 'kitsuId': {
        const animeEntry = AnimeDatabase.getInstance().getEntryById(
          parsedId.type,
          parsedId.value
        );
        if (!animeEntry || !animeEntry.animeSeason?.year) {
          throw new Error('Anime entry not found');
        }
        titles = [];
        if (animeEntry.synonyms) {
          titles.push(...animeEntry.synonyms);
        }
        if (animeEntry.title) {
          titles.push(animeEntry.title);
        }
        titles = [...new Set(titles)];
        year = animeEntry.animeSeason?.year;
        break;
      }
      case this.userData.metadataSource === 'imdb': {
        const imdbMetadata = new IMDBMetadata();
        const metadata = await imdbMetadata.getTitleAndYear(
          parsedId.value.toString(),
          type
        );
        titles = metadata.titles ?? [metadata.title];
        const traktAliases = await getTraktAliases(parsedId);
        if (traktAliases) {
          titles.push(...traktAliases);
        }
        titles = [...new Set(titles)];
        year = metadata.year;
        break;
      }
      case this.userData.metadataSource === 'tmdb': {
        if (!this.userData.tmdbReadAccessToken) {
          throw new Error('TMDB API Key is not set');
        }
        const tmdbMetadata = new TMDBMetadata({
          accessToken: this.userData.tmdbReadAccessToken,
        });
        const metadata = await tmdbMetadata.getMetadata(parsedId);
        titles = metadata.titles ?? [metadata.title];
        year = Number(metadata.year);
        if (parsedId.type === 'imdbId') {
          const traktAliases = await getTraktAliases(parsedId);
          if (traktAliases) {
            titles.push(...traktAliases);
          }
          titles = [...new Set(titles)];
        }
        break;
      }
      default:
        throw new Error('Metadata source is not set');
    }
    return { titles, year };
  }

  private buildSearchQuery(
    titles: string[],
    year?: number,
    season?: string,
    episode?: string
  ) {
    const isShow = season || episode;
    let query =
      "trashed=false and not name contains 'trailer' and not name contains 'sample'";

    const mimeTypes = this.getMimeTypes();
    query += ` and (${mimeTypes.map((mimeType) => `mimeType contains '${mimeType}'`).join(' or ')})`;

    // look for season x in any title and extract the season number, and also remove the season x from the title
    titles = titles.map((title) => {
      const seasonMatch = title.match(/season\s+(\d+)/i);
      if (seasonMatch) {
        season = seasonMatch[1];
        title = title.replace(/season\s+\d+/i, '').trim();
      }
      return title;
    });

    const sanitisedTitles = titles.map((title) =>
      title.replace(/[^\p{L}\p{N}\s]/gu, '')
    );
    const possibleTitles = Array.from(
      new Set([
        ...sanitisedTitles,
        ...sanitisedTitles.map((title) => title.replace(/'/g, "\\'")),
      ])
    );

    if (isShow || !year) {
      query += ` and (${possibleTitles.map((title) => `name contains '${title}'`).join(' or ')})`;
    } else {
      query += ` and (${possibleTitles.map((title) => `name contains '${title} ${year}'`).join(' or ')})`;
    }

    if (!isShow) {
      return query;
    }

    const seasonNum = season ? parseInt(season, 10) : undefined;
    const episodeNum = episode ? parseInt(episode, 10) : undefined;

    const getFormats = (s: number | undefined, e: number | undefined) => {
      const sPad = s ? s.toString().padStart(2, '0') : undefined;
      const ePad = e ? e.toString().padStart(2, '0') : undefined;
      if (!sPad && !ePad) return new Set();

      if (e && s) {
        return new Set([
          `s${s}e${e}`,
          `s${sPad}e${ePad}`,
          `s${s}.e${e}`,
          `s${sPad}.e${ePad}`,
          `${s}x${e}`,
          `${s}x${ePad}`,
          `s${s}xe${e}`,
          `s${sPad}xe${ePad}`,
          `season ${s} episode ${e}`,
          `season ${sPad} episode ${ePad}`,
          `s${s} ep${e}`,
          `s${sPad} ep${ePad}`,
        ]);
      } else if (e) {
        return new Set([
          `e${e}`,
          `e${ePad}`,
          `ep${e}`,
          `ep${ePad}`,
          `episode ${e}`,
        ]);
      } else if (s) {
        return new Set([`s${s}`, `s${sPad}`, `season ${s}`, `season ${sPad}`]);
      }
      return new Set();
    };

    const formats = Array.from(getFormats(seasonNum, episodeNum));

    query += ` and (${formats
      .map((format) => `fullText contains '${format}'`)
      .join(' or ')})`;

    return query;
  }

  public async getCatalog(
    type: string,
    id: string,
    extras?: string
  ): Promise<MetaPreview[]> {
    const parsedExtras = extras ? new ExtrasParser(extras) : undefined;
    const sort = (this.userData.catalogSort || ['createdTime ↓'])
      .map((sort) => sort.replace(' ↑', '').replace(' ↓', ' desc'))
      .join(',');
    if (type !== 'movie' || id !== 'gdrive.videos') {
      throw new Error('Unsupported type or ID for Catalog request');
    }
    let filesToFetch = 100;
    let filesToSkip = 0;
    if (parsedExtras?.skip) {
      filesToFetch = parsedExtras.skip + 100;
      filesToSkip = parsedExtras.skip;
    }
    if (filesToFetch > Env.BUILTIN_GDRIVE_PAGE_SIZE_LIMIT) {
      filesToFetch = Env.BUILTIN_GDRIVE_PAGE_SIZE_LIMIT;
    }

    const sanitiseQuery = (query: string) => {
      return decodeURIComponent(query).replace(/'/g, "\\'");
    };
    let query = '';
    if (parsedExtras?.search && parsedExtras.search.startsWith('rawQuery:')) {
      const rawQuery = parsedExtras.search.split('rawQuery:')[1];
      query = rawQuery;
    } else {
      query = `(${this.getMimeTypes()
        .map((mimeType) => `mimeType contains '${mimeType}'`)
        .join(
          ' or '
        )}) and trashed=false and not name contains 'trailer' and not name contains 'sample'`;

      if (parsedExtras?.search) {
        query += ` and name contains '${sanitiseQuery(parsedExtras.search)}'`;
      }
    }
    logger.debug(`Catalog query: ${query}`);

    const { files } = await this.api.listFiles({
      fields:
        'files(id,name,description,size,createdTime,modifiedTime,thumbnailLink,iconLink,videoMediaMetadata,fileExtension)',
      orderBy: sort,
      pageSize: filesToFetch,
      corpora: 'allDrives',
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      q: query,
    });

    const accessToken = await this.oauth.getAccessToken();
    return files
      .slice(filesToSkip, filesToFetch)
      .map((file) => this.createMeta(file, accessToken));
  }

  public async getMeta(type: string, id: string): Promise<Meta> {
    if (type !== 'movie' || !id.startsWith('gdrive.')) {
      throw new Error('Unsupported type or ID for Meta request');
    }

    const fileId = id.split('.')[1];
    const file = await this.api.getFile(fileId, {
      supportsAllDrives: true,
      fields:
        'id,name,description,size,createdTime,modifiedTime,thumbnailLink,iconLink,videoMediaMetadata,fileExtension',
    });

    const accessToken = await this.oauth.getAccessToken();
    return this.createMeta(file, accessToken);
  }

  private createMeta(
    file: GDriveFile,
    accessToken?: string,
    subtitles?: Subtitle[]
  ): Meta {
    const descriptionParts = [];
    if (file.description) descriptionParts.push(file.description);
    descriptionParts.push(
      `📅 ${new Date(file.createdTime).toLocaleDateString()}`
    );
    if (file.modifiedTime !== file.createdTime) {
      descriptionParts.push(
        `(Modified: ${new Date(file.modifiedTime).toLocaleDateString()})`
      );
    }
    descriptionParts.push(`📦 ${formatBytes(Number(file.size), 1000)}`);
    if (file.videoMediaMetadata?.durationMs) {
      descriptionParts.push(
        `⏱️ ${formatDuration(file.videoMediaMetadata.durationMs)}`
      );
    }
    if (file.videoMediaMetadata) {
      descriptionParts.push(
        `🎬 ${file.videoMediaMetadata.width}x${file.videoMediaMetadata.height}`
      );
    }
    if (file.fileExtension) {
      descriptionParts.push(`📄 ${file.fileExtension.toUpperCase()}`);
    }

    return {
      id: `gdrive.${file.id}`,
      name: file.name,
      description: descriptionParts.join(' • '),
      poster: file.thumbnailLink,
      posterShape: 'landscape',
      background: file.thumbnailLink,
      type: 'movie',
      videos: accessToken
        ? [
            {
              id: file.id,
              title: file.name,
              released: file.createdTime,
              thumbnail: file.thumbnailLink,
              streams: [this.createStream(file, accessToken)],
            },
          ]
        : [],
    };
  }

  private createStream(
    file: GDriveFile,
    accessToken: string
  ): Stream & { duration: number | undefined } {
    return {
      name: `Stremio GDrive`,
      subtitles: [],
      url: `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`,
      duration: file.videoMediaMetadata?.durationMs,
      behaviorHints: {
        filename: file.name,
        videoSize: file.size ? Number(file.size) : undefined,
        notWebReady: true,
        proxyHeaders: {
          request: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      },
    };
  }
}
