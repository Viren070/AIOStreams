import { ParsedStream, UserData } from '../db/schemas.js';
import { createLogger } from '../utils/index.js';
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
    const streamUrl = new URL(stream.url);
    const proxyUrl = new URL(proxy.url);
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
    logger.info(`Proxying ${streamsToProxy.length} streams`);

    const proxy = createProxy(this.userData.proxy);

    const proxiedUrls = streamsToProxy.length
      ? await proxy.generateUrls(
          streamsToProxy.map(({ stream }) => ({
            url: stream.url!,
            filename: stream.filename,
            headers: {
              request: stream.requestHeaders,
              response: stream.responseHeaders,
            },
          }))
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
