import { ParsedStream, UserData } from '../db/schemas';
import { createLogger } from '../utils';
import { createProxy } from '../proxy';

const logger = createLogger('proxifier');

class Proxifier {
  private userData: UserData;

  constructor(userData: UserData) {
    this.userData = userData;
  }

  private shouldProxyStream(stream: ParsedStream): boolean {
    const streamService = stream.service ? stream.service.id : 'none';
    const proxy = this.userData.proxy;
    if (!stream.url || !proxy?.enabled) {
      return false;
    }

    const proxyAddon =
      !proxy.proxiedAddons?.length ||
      proxy.proxiedAddons.includes(stream.addon.presetInstanceId);
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
