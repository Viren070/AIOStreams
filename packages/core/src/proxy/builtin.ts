import { BaseProxy, ProxyStream } from './base.js';
import {
  appConfig,
  createLogger,
  maskSensitiveInfo,
  Env,
  makeRequest,
  encryptString,
  Cache,
  getSimpleTextHash,
  toUrlSafeBase64,
  constants,
  checkAuthToken,
  Permission,
  isAdminUser,
  verifyConfigProxyGrant,
} from '../utils/index.js';
import z from 'zod';

const logger = createLogger('builtin');

const cache = Cache.getInstance<string, string>('publicIp');

export class BuiltinProxy extends BaseProxy {
  public static validateAuth(auth: string): {
    username: string;
    password: string;
    admin: boolean;
  } {
    const grant = verifyConfigProxyGrant(auth);
    if (grant) {
      return {
        username: grant.identity,
        password: auth,
        admin: false,
      };
    }

    const check = checkAuthToken(auth, Permission.Proxy);
    if (!check.ok) {
      throw new Error(`Invalid AIOStreams auth: ${check.reason}`);
    }

    return {
      username: check.username,
      password: check.password,
      admin: isAdminUser(check.username),
    };
  }

  protected override generateProxyUrl(endpoint: string): URL {
    return new URL(endpoint);
  }

  protected override getPublicIpEndpoint(): string {
    return '';
  }

  protected override getPublicIpFromResponse(data: any): string | null {
    return null;
  }

  protected override getHeaders(): Record<string, string> {
    return {};
  }

  public override async getPublicIp(): Promise<string | null> {
    BuiltinProxy.validateAuth(this.config.credentials);

    if (this.config.publicIp) {
      return this.config.publicIp;
    }

    const cacheKey = `${this.config.id}:${this.config.url}:${getSimpleTextHash(this.config.credentials ?? '')}`;
    const cachedPublicIp = cache ? await cache.get(cacheKey) : null;
    if (cachedPublicIp) {
      logger.debug('returning cached public ip');
      return cachedPublicIp;
    }

    const response = await makeRequest('https://checkip.amazonaws.com', {
      method: 'GET',
      timeout: 10000,
    });

    if (!response.ok) {
      throw new Error(
        `Failed to check public IP using AWS: ${response.status}: ${response.statusText}`
      );
    }

    const publicIp = (await response.text()).trim();

    const { error, success } = z
      .union([z.ipv4(), z.ipv6()])
      .safeParse(publicIp);
    if (error || !success) {
      logger.error({ ip: publicIp }, 'aws returned invalid ip');
      throw new Error(`Proxy did not respond with a valid public IP`);
    }

    if (publicIp && cache) {
      await cache.set(cacheKey, publicIp, appConfig.proxy.ip.cacheTtl);
    } else {
      logger.error('aws checkip returned no usable ip');
      throw new Error('Proxy did not respond with a public IP');
    }
    return publicIp;
  }

  protected override async generateStreamUrls(
    streams: ProxyStream[],
    encrypt: boolean = true
  ): Promise<string[] | null> {
    const auth = BuiltinProxy.validateAuth(this.config.credentials);

    return streams.map((stream) => {
      let authData = JSON.stringify({
        username: auth.username,
        password: auth.password,
      });
      let streamData = JSON.stringify({
        url: stream.url,
        filename: stream.filename,
        requestHeaders: stream.headers?.request,
        responseHeaders: stream.headers?.response,
        type: stream.type ?? 'stream',
      });

      if (encrypt) {
        const { success, data, error } = encryptString(authData);
        if (!success) {
          throw new Error(`Failed to encrypt auth data: ${error}`);
        }
        authData = data;
      } else {
        authData = toUrlSafeBase64(authData);
      }
      if (encrypt) {
        const { success, data, error } = encryptString(streamData);
        if (!success) {
          throw new Error(`Failed to encrypt stream data: ${error}`);
        }
        streamData = data;
      } else {
        streamData = toUrlSafeBase64(streamData);
      }

      return `${appConfig.bootstrap.baseUrl}${constants.BUILTIN_PROXY_PATH_PREFIX}${encrypt ? 'e' : 'u'}.${authData}.${streamData}/${encodeURIComponent(stream.filename ?? '')}`;
    });
  }
}
