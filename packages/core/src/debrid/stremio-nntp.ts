import {
  DebridDownload,
  DebridService,
  DebridServiceConfig,
  PlaybackInfo,
} from './base.js';
import { ServiceId, createLogger, fromUrlSafeBase64 } from '../utils/index.js';
import { NNTPServers, NNTPServersSchema } from '../db/schemas.js';

const logger = createLogger('stremio-nntp');

export class StremioNNTPService implements DebridService {
  readonly serviceName: ServiceId = 'stremio_nntp';
  readonly serviceLogger = logger;

  private servers: NNTPServers;

  supportsUsenet: boolean = true;

  constructor(config: DebridServiceConfig) {
    const parsedConfig = NNTPServersSchema.parse(
      JSON.parse(Buffer.from(config.token, 'base64').toString())
    );
    this.servers = parsedConfig;
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

  addTorrent(torrent: string): Promise<DebridDownload> {
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

  resolve(
    playbackInfo: PlaybackInfo,
    filename: string,
    cacheAndPlay: boolean
  ): Promise<string | undefined> {
    throw new Error('Method not implemented.');
  }

  generateTorrentLink(link: string, clientIp?: string): Promise<string> {
    throw new Error('Method not implemented.');
  }
}
