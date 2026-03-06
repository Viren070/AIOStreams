import {
  DebridDownload,
  DebridServiceConfig,
  PlaybackInfo,
  UsenetDebridService,
} from './base.js';
import { ServiceId, createLogger, fromUrlSafeBase64 } from '../utils/index.js';
import { NNTPServers, NNTPServersSchema } from '../db/schemas.js';

const logger = createLogger('stremio-nntp');

export class StremioNNTPService implements UsenetDebridService {
  readonly serviceName: ServiceId = 'stremio_nntp';
  readonly capabilities = { torrents: false, usenet: true };
  readonly serviceLogger = logger;

  private servers: NNTPServers;

  constructor(config: DebridServiceConfig) {
    const parsedConfig = NNTPServersSchema.parse(
      JSON.parse(Buffer.from(config.token, 'base64').toString())
    );
    this.servers = parsedConfig;
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

  resolve(
    playbackInfo: PlaybackInfo,
    filename: string,
    cacheAndPlay: boolean
  ): Promise<string | undefined> {
    throw new Error('Method not implemented.');
  }
}
