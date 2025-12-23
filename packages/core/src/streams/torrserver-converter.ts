import { ParsedStream, UserData } from '../db/schemas.js';
import { createLogger, ServiceId, TORRSERVER_SERVICE } from '../utils/index.js';
import { TorrServerConfig } from '../debrid/torrserver.js';

const logger = createLogger('torrserver-converter');

class TorrServerConverter {
  private userData: UserData;
  private torrServerUrl?: string;
  private torrServerAuth?: string;
  private hasTorrServer: boolean = false;

  constructor(userData: UserData) {
    this.userData = userData;
    this.initializeTorrServer();
  }

  private initializeTorrServer() {
    // Check if TorrServer is configured in services
    const torrServerService = this.userData.services?.find(
      (s) => s.id === TORRSERVER_SERVICE && s.enabled !== false
    );

    if (torrServerService) {
      try {
        const config = TorrServerConfig.parse(torrServerService.credentials);
        this.torrServerUrl = config.torrserverUrl;
        this.torrServerAuth = config.torrserverAuth;
        this.hasTorrServer = true;
        logger.info('TorrServer service configured for P2P stream conversion');
      } catch (error) {
        logger.error(
          `Failed to parse TorrServer credentials: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }

  private addAuthToStreamUrl(url: URL): void {
    if (!this.torrServerAuth) return;

    const trimmedAuth = this.torrServerAuth.trim();
    if (trimmedAuth === '') return;

    if (trimmedAuth.includes(':')) {
      // Basic auth credentials (username:password) - add to URL
      // Handle passwords that may contain colons by only splitting on the first colon
      const colonIndex = trimmedAuth.indexOf(':');
      const username = trimmedAuth.substring(0, colonIndex);
      const password = trimmedAuth.substring(colonIndex + 1);
      url.username = username;
      url.password = password;
    } else {
      // API key - add as query parameter
      url.searchParams.set('apikey', trimmedAuth);
    }
  }

  public async convert(streams: ParsedStream[]): Promise<ParsedStream[]> {
    if (!this.hasTorrServer || !this.torrServerUrl) {
      return streams;
    }

    let convertedCount = 0;

    const convertedStreams = streams.map((stream) => {
      // Only convert P2P streams that don't already have a URL
      if (
        stream.type === 'p2p' &&
        stream.torrent?.infoHash &&
        !stream.url &&
        !stream.externalUrl
      ) {
        const infoHash = stream.torrent.infoHash;
        const magnet = this.buildMagnetLink(
          infoHash,
          stream.torrent.sources || []
        );

        // Build TorrServer stream URL
        const streamUrlObj = new URL('/stream', this.torrServerUrl!); // Non-null assertion safe due to check above
        streamUrlObj.searchParams.set('link', magnet);
        streamUrlObj.searchParams.set('play', '1'); // Auto play
        streamUrlObj.searchParams.set('save', 'true');

        if (stream.torrent.fileIdx !== undefined) {
          streamUrlObj.searchParams.set(
            'index',
            String(stream.torrent.fileIdx + 1)
          );
        } else {
          // If no index is provided in P2P stream, default to 1 (usually main file)
          streamUrlObj.searchParams.set('index', '1');
        }

        // IMPORTANT: Append auth (API Key or Basic Auth) to the playback URL if configured
        this.addAuthToStreamUrl(streamUrlObj);

        const torrServerUrl = streamUrlObj.toString();

        convertedCount++;

        return {
          ...stream,
          url: torrServerUrl,
          type: 'debrid' as const,
          service: {
            id: TORRSERVER_SERVICE as ServiceId,
            cached: true, // Mark as cached so AIOStreams treats it as instant play
          },
        };
      }

      return stream;
    });

    if (convertedCount > 0) {
      logger.info(
        `Converted ${convertedCount} P2P streams to TorrServer playback URLs`
      );
    }

    return convertedStreams;
  }

  private buildMagnetLink(infoHash: string, trackers: string[]): string {
    let magnet = `magnet:?xt=urn:btih:${infoHash}`;
    if (trackers && trackers.length > 0) {
      const encodedTrackers = trackers.map((t) => encodeURIComponent(t));
      magnet += `&tr=${encodedTrackers.join('&tr=')}`;
    }
    return magnet;
  }
}

export default TorrServerConverter;
