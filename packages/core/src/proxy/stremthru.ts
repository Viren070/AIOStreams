import { BaseProxy, ProxyStream } from './base.js';
import { createLogger, maskSensitiveInfo, Env } from '../utils/index.js';

const logger = createLogger('stremthru');

export class StremThruProxy extends BaseProxy {
  protected generateProxyUrl(endpoint: string): URL {
    const proxyUrl = new URL(this.config.url.replace(/\/$/, ''));
    proxyUrl.pathname = `${proxyUrl.pathname === '/' ? '' : proxyUrl.pathname}${endpoint}`;
    return proxyUrl;
  }

  protected getPublicIpEndpoint(): string {
    return '/v0/health/__debug__';
  }

  protected getPublicIpFromResponse(data: any): string | null {
    return typeof data.data?.ip?.exposed === 'object'
      ? data.data.ip.exposed['*'] || data.data.ip.machine
      : data.data?.ip?.machine || null;
  }

  protected getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
    };

    if (Env.ENCRYPT_STREMTHRU_URLS) {
      headers['X-StremThru-Authorization'] = `Basic ${this.config.credentials}`;
    }

    return headers;
  }

  protected async generateStreamUrls(
    streams: ProxyStream[]
  ): Promise<string[] | null> {
    const proxyUrl = this.generateProxyUrl('/v0/proxy');

    if (!Env.ENCRYPT_STREMTHRU_URLS) {
      proxyUrl.searchParams.set('token', this.config.credentials);
    }

    const data = new URLSearchParams();

    streams.forEach((stream, i) => {
      data.append('url', stream.url);
      let req_headers = '';
      if (stream.headers?.request) {
        for (const [key, value] of Object.entries(stream.headers.request)) {
          req_headers += `${key}: ${value}\n`;
        }
      }
      data.append(`req_headers[${i}]`, req_headers);
      if (stream.filename) {
        data.append(`filename[${i}]`, stream.filename);
      }
    });

    if (Env.LOG_SENSITIVE_INFO) {
      logger.debug(`POST ${proxyUrl.toString()}`);
    } else {
      logger.debug(
        `POST ${proxyUrl.protocol}://${maskSensitiveInfo(proxyUrl.hostname)}${proxyUrl.port ? `:${proxyUrl.port}` : ''}/v0/proxy`
      );
    }

    const response = await fetch(proxyUrl.toString(), {
      method: 'POST',
      headers: this.getHeaders(),
      body: data,
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      throw new Error(`${response.status}: ${response.statusText}`);
    }

    let responseData: any;
    try {
      responseData = await response.json();
    } catch (error) {
      const text = await response.text();
      logger.debug(`Response body: ${text}`);
      throw new Error('Failed to parse JSON response from StremThru');
    }

    if (responseData.error) {
      throw new Error(responseData.error);
    }

    if (responseData.data?.items) {
      return responseData.data.items;
    } else {
      throw new Error('No URLs were returned from StremThru');
    }
  }
}
