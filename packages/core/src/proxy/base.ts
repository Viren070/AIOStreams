import { StreamProxyConfig } from '../db/schemas.js';
import { Cache, createLogger, maskSensitiveInfo, Env } from '../utils/index.js';

const logger = createLogger('proxy');
const cache = Cache.getInstance<string, string>('publicIp');

export interface ProxyStream {
  url: string;
  filename?: string;
  headers?: {
    request?: Record<string, string>;
    response?: Record<string, string>;
  };
}

type ValidatedStreamProxyConfig = StreamProxyConfig & {
  id: 'mediaflow' | 'stremthru';
  url: string;
  credentials: string;
};

export abstract class BaseProxy {
  protected readonly config: ValidatedStreamProxyConfig;
  private readonly PRIVATE_CIDR =
    /^(10\.|127\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.)/;

  constructor(config: StreamProxyConfig) {
    if (!config.id || !config.credentials || !config.url) {
      throw new Error('Proxy configuration is missing');
    }

    this.config = {
      enabled: config.enabled ?? false,
      id: config.id,
      url: config.url,
      publicUrl: config.publicUrl,
      credentials: config.credentials,
      publicIp: config.publicIp,
      proxiedAddons: config.proxiedAddons,
      proxiedServices: config.proxiedServices,
    };
  }

  public getConfig(): StreamProxyConfig {
    return this.config;
  }

  protected abstract generateProxyUrl(endpoint: string): URL;
  protected abstract getPublicIpEndpoint(): string;
  protected abstract getPublicIpFromResponse(data: any): string | null;
  protected abstract generateStreamUrls(
    streams: ProxyStream[]
  ): Promise<string[] | null>;

  public async getPublicIp(): Promise<string | null> {
    if (!this.config.url) {
      logger.error('Proxy URL is missing');
      throw new Error('Proxy URL is missing');
    }

    if (this.config.publicIp) {
      return this.config.publicIp;
    }

    const proxyUrl = new URL(this.config.url.replace(/\/$/, ''));
    if (this.PRIVATE_CIDR.test(proxyUrl.hostname)) {
      logger.error('Proxy URL is a private IP address, returning null');
      return null;
    }

    const cacheKey = `${this.config.id}:${this.config.url}:${this.config.credentials}`;
    const cachedPublicIp = cache ? await cache.get(cacheKey) : null;
    if (cachedPublicIp) {
      logger.debug('Returning cached public IP');
      return cachedPublicIp;
    }

    const ipUrl = this.generateProxyUrl(this.getPublicIpEndpoint());

    if (Env.LOG_SENSITIVE_INFO) {
      logger.debug(`GET ${ipUrl.toString()}`);
    } else {
      logger.debug(
        `GET ${ipUrl.protocol}://${maskSensitiveInfo(ipUrl.hostname)}${ipUrl.port ? `:${ipUrl.port}` : ''}${ipUrl.pathname}`
      );
    }

    const response = await fetch(ipUrl.toString(), {
      method: 'GET',
      headers: this.getHeaders(),
      signal: AbortSignal.timeout(30000), // 30 second timeout
    });

    if (!response.ok) {
      throw new Error(`${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    const publicIp = this.getPublicIpFromResponse(data);

    if (publicIp && cache) {
      await cache.set(cacheKey, publicIp, Env.PROXY_IP_CACHE_TTL);
    } else {
      logger.error(
        `Proxy did not respond with a public IP. Response: ${JSON.stringify(data)}`
      );
      throw new Error('Proxy did not respond with a public IP');
    }

    return publicIp;
  }

  protected abstract getHeaders(): Record<string, string>;

  public async generateUrls(streams: ProxyStream[]): Promise<string[] | null> {
    if (!streams.length) {
      return [];
    }

    if (!this.config) {
      throw new Error('Proxy configuration is missing');
    }

    try {
      let urls = await this.generateStreamUrls(streams);
      const publicUrl = this.config.publicUrl;
      if (publicUrl && urls) {
        const publicUrlObj = new URL(publicUrl);
        const publicBasePath = publicUrlObj.pathname.replace(/\/+$/, ''); // remove trailing slash
        urls = urls.map((url) => {
          const urlObj = new URL(url);

          // Set protocol, hostname, and port from publicUrl
          urlObj.protocol = publicUrlObj.protocol;
          urlObj.hostname = publicUrlObj.hostname;
          urlObj.port = publicUrlObj.port;

          // Adjust pathname: join publicUrl's base path with the original path, avoiding duplicate slashes
          const origPath = urlObj.pathname.replace(/^\/+/, ''); // remove leading slash
          urlObj.pathname = publicBasePath
            ? `${publicBasePath}/${origPath}`.replace(/\/{2,}/g, '/')
            : `/${origPath}`;

          return urlObj.toString();
        });
      }
      return urls;
    } catch (error) {
      logger.error(
        `Failed to generate proxy URLs: ${error instanceof Error ? error : String(error)}`,
        error instanceof Error
          ? Object.fromEntries(
              Object.entries(error).filter(([key]) => key !== 'stack')
            )
          : undefined
      );
      return null;
    }
  }
}
