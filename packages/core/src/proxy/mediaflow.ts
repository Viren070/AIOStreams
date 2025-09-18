import { BaseProxy, ProxyStream } from './base.js';
import { createLogger, maskSensitiveInfo, Env } from '../utils/index.js';
import path from 'path';

const logger = createLogger('mediaflow');

export class MediaFlowProxy extends BaseProxy {
  protected generateProxyUrl(endpoint: string): URL {
    const proxyUrl = new URL(this.config.url.replace(/\/$/, ''));
    proxyUrl.pathname = `${proxyUrl.pathname === '/' ? '' : proxyUrl.pathname}${endpoint}`;
    if (endpoint === '/proxy/ip') {
      proxyUrl.searchParams.set('api_password', this.config.credentials);
    }
    return proxyUrl;
  }

  protected getPublicIpEndpoint(): string {
    return '/proxy/ip';
  }

  protected getPublicIpFromResponse(data: any): string | null {
    return data.ip || null;
  }

  protected getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
    };
  }

  protected async generateStreamUrls(
    streams: ProxyStream[]
  ): Promise<string[] | null> {
    const proxyUrl = this.generateProxyUrl('/generate_urls');

    const data = {
      mediaflow_proxy_url: this.config.url.replace(/\/$/, ''),
      api_password: Env.ENCRYPT_MEDIAFLOW_URLS
        ? this.config.credentials
        : undefined,
      urls: streams.map((stream) => ({
        endpoint: '/proxy/stream',
        filename: stream.filename || path.basename(stream.url),
        query_params: Env.ENCRYPT_MEDIAFLOW_URLS
          ? undefined
          : {
              api_password: this.config.credentials,
            },
        destination_url: stream.url,
        request_headers: stream.headers?.request,
        response_headers: stream.headers?.response,
      })),
    };

    if (Env.LOG_SENSITIVE_INFO) {
      logger.debug(`POST ${proxyUrl.toString()}`);
    } else {
      logger.debug(
        `POST ${proxyUrl.protocol}://${maskSensitiveInfo(proxyUrl.hostname)}${proxyUrl.port ? `:${proxyUrl.port}` : ''}/generate_urls`
      );
    }

    const response = await fetch(proxyUrl.toString(), {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(data),
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
      throw new Error('Failed to parse JSON response from MediaFlow');
    }

    if (responseData.error) {
      throw new Error(responseData.error);
    }

    if (responseData.urls) {
      return responseData.urls;
    } else {
      throw new Error('No URLs were returned from MediaFlow');
    }
  }
}
