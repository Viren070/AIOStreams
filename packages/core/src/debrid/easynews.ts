import {
  DebridDownload,
  DebridError,
  DebridService,
  DebridServiceConfig,
  PlaybackInfo,
} from './base.js';
import {
  Cache,
  DistributedLock,
  Env,
  ServiceId,
  createLogger,
  fromUrlSafeBase64,
} from '../utils/index.js';
import { NNTPServers, NNTPServersSchema } from '../db/schemas.js';
import z from 'zod';

const logger = createLogger('easynews');

const EasynewsAuthSchema = z.object({
  username: z.string(),
  password: z.string(),
});

export class EasynewsService implements DebridService {
  readonly serviceName: ServiceId = 'easynews';
  readonly serviceLogger = logger;

  private auth: z.infer<typeof EasynewsAuthSchema>;
  protected static playbackLinkCache = Cache.getInstance<string, string>(
    'easynews:link'
  );

  supportsUsenet: boolean = true;

  constructor(private readonly config: DebridServiceConfig) {
    const auth = EasynewsAuthSchema.parse(
      JSON.parse(Buffer.from(config.token, 'base64').toString())
    );
    this.auth = auth;
  }

  checkMagnets(magnets: string[], sid?: string): Promise<DebridDownload[]> {
    throw new Error('Method not implemented.');
  }

  listMagnets(): Promise<DebridDownload[]> {
    throw new Error('Method not implemented.');
  }

  addMagnet(magnet: string): Promise<DebridDownload> {
    throw new Error('Method not implemented.');
  }

  addTorrent(downloadUrl: string): Promise<DebridDownload> {
    throw new Error('Method not implemented.');
  }

  async checkNzbs(
    nzbs: { name?: string; hash?: string }[],
    checkOwned?: boolean
  ): Promise<DebridDownload[]> {
    return nzbs.map(({ hash: h, name: n }, index) => {
      return {
        id: index,
        status: 'cached',
        library: false,
        hash: h,
        name: n,
      };
    });
  }

  public async resolve(
    playbackInfo: PlaybackInfo,
    filename: string,
    cacheAndPlay: boolean
  ): Promise<string | undefined> {
    if (playbackInfo.type === 'torrent') {
      throw new Error('Unsupported operation');
    }
    const { result } = await DistributedLock.getInstance().withLock(
      `${this.serviceName}:resolve:${playbackInfo.hash}:${playbackInfo.metadata?.season}:${playbackInfo.metadata?.episode}:${playbackInfo.metadata?.absoluteEpisode}:${filename}:${this.config.clientIp}:${this.config.token}`,
      () => this._resolve(playbackInfo, filename),
      {
        timeout: 10000,
        ttl: 10000,
      }
    );
    return result;
  }

  private async _resolve(
    playbackInfo: PlaybackInfo,
    filename: string
  ): Promise<string | undefined> {
    if (playbackInfo.type === 'torrent') {
      throw new Error('Unsupported operation');
    }
    const { easynewsUrl } = playbackInfo;

    const cacheKey = `${easynewsUrl}:${this.auth.username}:${this.auth.password}`;
    const cachedLink = await EasynewsService.playbackLinkCache.get(cacheKey);

    if (cachedLink !== undefined) {
      logger.debug(`Using cached link for ${easynewsUrl}`);
      return cachedLink;
    }
    if (!easynewsUrl) {
      throw new DebridError('Easynews URL not found in playback info', {
        code: 'NOT_FOUND',
        statusCode: 404,
        statusText: 'Not Found',
        headers: {},
      });
    }

    // make a request to easynews url, and return the final redirected url
    logger.debug(`Resolving Easynews URL: ${easynewsUrl}`);
    const response = await fetch(easynewsUrl, {
      method: 'GET',
      headers: {
        Authorization: `Basic ${Buffer.from(
          `${this.auth.username}:${this.auth.password}`
        ).toString('base64')}`,
        Range: 'bytes=0-0',
      },
      redirect: 'manual',
    });

    const finalUrl = response.headers.get('location');

    if (![302, 301].includes(response.status) || !finalUrl) {
      throw new DebridError(
        `Failed to resolve Easynews URL, status code: ${response.status}`,
        {
          code: 'NOT_FOUND',
          statusCode: response.status,
          statusText: response.statusText,
          headers: {},
        }
      );
    }

    logger.debug(`Resolved Easynews URL to final URL: ${finalUrl}`);

    await EasynewsService.playbackLinkCache.set(
      cacheKey,
      finalUrl,
      Env.BUILTIN_DEBRID_PLAYBACK_LINK_CACHE_TTL
    );
    return finalUrl;
  }

  generateTorrentLink(link: string, clientIp?: string): Promise<string> {
    throw new Error('Method not implemented.');
  }
}
