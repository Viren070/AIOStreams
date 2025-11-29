import { ParsedStream, UserData } from '../db/schemas.js';
import { constants, createLogger, Env } from '../utils/index.js';
import { createProxy } from '../proxy/index.js';

const logger = createLogger('proxy');

class Proxifier {
  private userData: UserData;

  constructor(userData: UserData) {
    this.userData = userData;
  }

  private shouldProxyStream(stream: ParsedStream): boolean {
    const streamService = stream.service ? stream.service.id : 'none';
    const proxy = this.userData.proxy;
    if (!stream.url || !proxy?.enabled || !proxy.url) {
      return false;
    }
    if (stream.proxied) {
      return false;
    }
    let streamUrl: URL;
    let proxyUrl: URL;
    try {
      streamUrl = new URL(stream.url);
      proxyUrl = new URL(proxy.url);
    } catch (error) {
      logger.error(
        `URL parsing failed somehow: stream: ${JSON.stringify(stream)}, proxy: ${JSON.stringify(proxy)}`
      );
      logger.error(error);
      return false;
    }
    // do not proxy the stream if it is a nzbdav/altmount stream from a built-in addon and the proxy is not the built-in proxy (i.e. only allow using built-in proxy for these)
    if (
      stream.service &&
      [constants.NZBDAV_SERVICE, constants.ALTMOUNT_SERVICE].includes(
        stream.service.id
      ) &&
      (streamUrl.host == new URL(Env.INTERNAL_URL).host ||
        streamUrl.host == new URL(Env.BASE_URL).host) &&
      proxy.id !== 'builtin'
    ) {
      return false;
    }
    if (
      streamUrl.host === proxyUrl.host &&
      // check for proxy endpoint for stremthru, not needed for mediaflow as all mediaflow links are proxied
      (proxy.id === 'mediaflow' || streamUrl.pathname.includes('/v0/proxy'))
    ) {
      stream.proxied = true;
      return false;
    }

    const proxyAddon =
      !proxy.proxiedAddons?.length ||
      proxy.proxiedAddons.includes(stream.addon.preset.id);
    const proxyService =
      !proxy.proxiedServices?.length ||
      proxy.proxiedServices.includes(streamService);

    if (proxy.enabled && proxyAddon && proxyService) {
      return true;
    }

    return false;
  }

  public async proxify(streams: ParsedStream[]): Promise<ParsedStream[]> {
    if (!this.userData.proxy?.enabled) {
      return streams;
    }

    const streamsToProxy = streams
      .map((stream, index) => ({ stream, index }))
      .filter(({ stream }) => stream.url && this.shouldProxyStream(stream));

    if (streamsToProxy.length === 0) {
      return streams;
    }

    const normaliseHeaders = (
      headers: Record<string, string> | undefined
    ): Record<string, string> | undefined => {
      if (!headers) {
        return undefined;
      }
      const normalisedHeaders: Record<string, string> = {};
      for (const [key, value] of Object.entries(headers)) {
        normalisedHeaders[key.trim().toLowerCase()] = value.trim();
      }
      return normalisedHeaders;
    };
    logger.info(`Proxying ${streamsToProxy.length} streams`);

    const proxy = createProxy(this.userData.proxy);

    const proxiedUrls = streamsToProxy.length
      ? await proxy.generateUrls(
          streamsToProxy.map(({ stream }) => {
            let url: string = stream.url!;
            let parsedUrl: URL | undefined;

            try {
              parsedUrl = new URL(url);
            } catch {}

            const headers = {
              response: normaliseHeaders(stream.responseHeaders),
              request: normaliseHeaders(stream.requestHeaders),
            };
            if (parsedUrl && parsedUrl.username && parsedUrl.password) {
              headers.request = {
                ...headers.request,
                authorization:
                  'Basic ' +
                  Buffer.from(
                    `${decodeURIComponent(
                      parsedUrl.username
                    )}:${decodeURIComponent(parsedUrl.password)}`
                  ).toString('base64'),
              };
              parsedUrl.username = '';
              parsedUrl.password = '';
              url = parsedUrl.toString();
            }
            return {
              url,
              filename: stream.filename,
              headers,
            };
          })
        )
      : [];

    logger.info(`Generated ${(proxiedUrls || []).length} proxied URLs`);

    const removeIndexes = new Set<number>();

    streamsToProxy.forEach(({ stream, index }, i) => {
      const proxiedUrl = proxiedUrls?.[i];
      if (proxiedUrl) {
        stream.url = proxiedUrl;
        stream.proxied = true;
        // proxy will handle request headers, can be removed here
        stream.requestHeaders = undefined;
      } else {
        removeIndexes.add(index);
      }
    });

    if (removeIndexes.size > 0) {
      logger.warn(
        `Failed to proxy ${removeIndexes.size} streams. Removing them from the list.`
      );
      streams = streams.filter((_, index) => !removeIndexes.has(index));
    }

    return streams;
  }
}

export default Proxifier;
