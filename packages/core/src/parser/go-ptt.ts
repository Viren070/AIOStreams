import { ParseResult, PTTServer } from 'go-ptt';
import os from 'os';
import {
  Cache,
  createLogger,
  Env,
  getSimpleTextHash,
  getTimeTakenSincePoint,
} from '../utils/index.js';

const logger = createLogger('parser');

const parseCache = Cache.getInstance<string, (ParseResult | null)[]>(
  'parseCache',
  undefined,
  true
);

class PTT {
  private static _pttServer: PTTServer | null = null;
  private static _pttConfig: {
    network: 'tcp' | 'unix';
    address: string;
  } =
    os.platform() === 'win32'
      ? {
          network: 'tcp',
          address: `:${Env.PTT_PORT}`,
        }
      : {
          network: 'unix',
          address: Env.PTT_SOCKET,
        };

  private constructor() {}

  public static async initialise(): Promise<PTTServer> {
    if (PTT._pttServer) {
      return PTT._pttServer;
    }
    PTT._pttServer = new PTTServer(PTT._pttConfig);
    await PTT._pttServer.start();
    logger.debug('PTT server started');
    return PTT._pttServer;
  }

  public static async cleanup(): Promise<void> {
    await PTT._pttServer?.stop();
    PTT._pttServer = null;
  }

  public static async parse(titles: string[]): Promise<(ParseResult | null)[]> {
    const cacheKey = getSimpleTextHash(titles.join('|'));
    const cached = await parseCache.get(cacheKey);
    if (cached) {
      return cached;
    }
    if (!PTT._pttServer) {
      throw new Error('PTT server not running');
    }
    if (titles.length === 0) {
      return [];
    }
    const parsedTitles: (ParseResult | null)[] = [];
    const startTime = Date.now();
    let results: ParseResult[] = [];
    try {
      results = await PTT._pttServer.parse({
        torrent_titles: titles,
        normalize: true,
      });
    } catch (error) {
      logger.error(
        `Error calling PTT server: ${error}, ${JSON.stringify((error as any).metadata)}`,
        error
      );
    }
    logger.debug(
      `PTT server parsed ${titles.length} titles in ${getTimeTakenSincePoint(startTime)}`
    );
    titles.forEach((title, idx) => {
      const result = results[idx];
      if (result.err) {
        logger.error(`Error parsing title ${title} (${idx}): ${result.err}`);
        parsedTitles.push(null);
      }
      parsedTitles.push(result);
    });
    await parseCache.set(cacheKey, parsedTitles, 60 * 60 * 24);
    return parsedTitles;
  }
}

export default PTT;
