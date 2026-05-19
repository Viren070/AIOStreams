import z from 'zod';
import { StreamProxyConfig } from '../db/schemas.js';
import {
  Cache,
  createLogger,
  maskSensitiveInfo,
  Env,
  constants,
} from '../utils/index.js';
import { config as appConfig } from '../config/index.js';

const logger = createLogger('proxy');
const cache = Cache.getInstance<string, string>('publicIp');

export interface ProxyStream {
  url: string;
  filename?: string;
  type?: 'nzb' | 'stream';
  headers?: {
    request?: Record<string, string>;
    response?: Record<string, string>;
  };
}

type ValidatedStreamProxyConfig = StreamProxyConfig & {
  id: 'mediaflow' | 'stremthru' | 'builtin';
  url: string;
  credentials: string;
};

export abstract class BaseProxy {
  protected readonly config: ValidatedStreamProxyConfig;
  private readonly PRIVATE_CIDR =
    /^(10\.|127\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.)/;

  constructor(config: StreamProxyConfig) {
    if (config.id === constants.BUILTIN_SERVICE) {
      config.url = appConfig.bootstrap.baseUrl;
      config.publicUrl = undefined;
    }
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
    streams: ProxyStream[],
    encrypt?: boolean
  ): Promise<string[] | null>;

  public async getPublicIp(): Promise<string | null> {
    if (!this.config.url) {
      logger.error('proxy url is missing');
      throw new Error('Proxy URL is missing');
    }

    if (this.config.publicIp) {
      return this.config.publicIp;
    }

    const proxyUrl = new URL(this.config.url.replace(/\/$/, ''));
    if (this.PRIVATE_CIDR.test(proxyUrl.hostname)) {
      logger.warn('proxy url is a private ip, skipping public ip lookup');
      return null;
    }

    const cacheKey = `${this.config.id}:${this.config.url}:${this.config.credentials}`;
    const cachedPublicIp = cache ? await cache.get(cacheKey) : null;
    if (cachedPublicIp) {
      logger.debug({ proxy: this.config.id }, 'returning cached proxy public ip');
      return cachedPublicIp;
    }

    const ipUrl = this.generateProxyUrl(this.getPublicIpEndpoint());
    logger.debug(
      { proxy: this.config.id, endpoint: `${ipUrl.protocol}//${maskSensitiveInfo(ipUrl.hostname)}${ipUrl.pathname}` },
      'fetching proxy public ip'
    );

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

    const { error, success } = z
      .union([z.ipv4(), z.ipv6()])
      .safeParse(publicIp);
    if (error || !success) {
      logger.error({ proxy: this.config.id, ip: publicIp }, 'proxy returned invalid ip');
      throw new Error(`Proxy did not respond with a valid public IP`);
    }

    if (publicIp && cache) {
      await cache.set(cacheKey, publicIp, appConfig.proxy.ip.cacheTtl);
    } else {
      logger.error({ proxy: this.config.id }, 'proxy did not return a public ip');
      throw new Error('Proxy did not respond with a public IP');
    }

    return publicIp;
  }

  protected abstract getHeaders(): Record<string, string>;

  public async generateUrls(
    streams: ProxyStream[],
    encrypt?: boolean
  ): Promise<string[] | { error: string } | null> {
    if (!streams.length) {
      return [];
    }

    if (!this.config) {
      throw new Error('Proxy configuration is missing');
    }

    try {
      let urls = await this.generateStreamUrls(streams, encrypt);
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
        { proxy: this.config.id, err: error instanceof Error ? error.message : String(error) },
        'failed to generate proxy urls'
      );
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }
}
