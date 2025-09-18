import {
  Addon,
  Option,
  UserData,
  Resource,
  Stream,
  ParsedStream,
} from '../db/index.js';
import { Preset, baseOptions } from './preset.js';
import { Env, SERVICE_DETAILS } from '../utils/index.js';
import { constants, ServiceId } from '../utils/index.js';
import { FileParser, StreamParser } from '../parser/index.js';

class NuvioStreamsStreamParser extends StreamParser {
  parse(stream: Stream): ParsedStream {
    let parsedStream: ParsedStream = {
      id: this.getRandomId(),
      addon: this.addon,
      type: 'http',
      url: this.applyUrlModifications(stream.url ?? undefined),
      externalUrl: stream.externalUrl ?? undefined,
      ytId: stream.ytId ?? undefined,
      requestHeaders: stream.behaviorHints?.proxyHeaders?.request,
      responseHeaders: stream.behaviorHints?.proxyHeaders?.response,
      notWebReady: stream.behaviorHints?.notWebReady ?? undefined,
      videoHash: stream.behaviorHints?.videoHash ?? undefined,
      originalName: stream.name ?? undefined,
      originalDescription: (stream.description || stream.title) ?? undefined,
    };

    stream.description = stream.description || stream.title;

    parsedStream.type = 'http';

    parsedStream.filename = stream.description?.split('\n')[0];
    parsedStream.parsedFile = parsedStream.filename
      ? FileParser.parse(parsedStream.filename)
      : FileParser.parse(`${stream.name}\n${stream.description}`);
    parsedStream.folderName = undefined;

    parsedStream.size = this.getSize(stream, parsedStream);

    parsedStream.indexer = stream.name
      ?.split('\n')?.[0]
      ?.split('|')?.[0]
      ?.split('-')?.[0]
      ?.trim();
    if (stream.description?.split('\n')?.[-1]?.includes('⚠️')) {
      parsedStream.message += `\n${stream.description?.split('\n')?.[-1]}`;
    }

    return parsedStream;
  }
}

export class NuvioStreamsPreset extends Preset {
  static override getParser(): typeof StreamParser {
    return NuvioStreamsStreamParser;
  }

  static override get METADATA() {
    const supportedResources = [constants.STREAM_RESOURCE];
    const regions = [
      {
        value: 'USA7',
        label: 'USA East',
      },
      {
        value: 'USA6',
        label: 'USA West',
      },
      {
        value: 'USA5',
        label: 'USA Middle',
      },
      {
        value: 'UK3',
        label: 'United Kingdom',
      },
      {
        value: 'CA1',
        label: 'Canada',
      },
      {
        value: 'FR1',
        label: 'France',
      },
      {
        value: 'DE2',
        label: 'Germany',
      },
      {
        value: 'HK1',
        label: 'Hong Kong',
      },
      {
        value: 'IN1',
        label: 'India',
      },
      {
        value: 'AU1',
        label: 'Australia',
      },
      {
        value: 'SZ',
        label: 'China',
      },
    ];
    const providers = [
      {
        value: 'showbox',
        label: 'Showbox',
      },
      {
        value: 'vidzee',
        label: 'Vidzee',
      },
      {
        value: 'vidsrc',
        label: 'Vidsrc',
      },
      {
        value: 'mp4hydra',
        label: 'MP4Hydra',
      },
      {
        value: 'uhdmovies',
        label: 'UHDMovies - 4K',
      },
      {
        value: 'moviesmod',
        label: 'MoviesMod',
      },
      {
        value: 'moviesdrive',
        label: 'MoviesDrive',
      },
      {
        value: '4khdhub',
        label: '4KHDHub - 4K/HD',
      },
      {
        value: 'dramadrip',
        label: 'DramaDrip - Asian Dramas',
      },
      {
        value: 'topmovies',
        label: 'TopMovies - Bollywood/Indian',
      },
      {
        value: 'animepahe',
        label: 'AnimePahe - Anime',
      },
    ];

    const options: Option[] = [
      ...baseOptions(
        'Nuvio Streams',
        supportedResources,
        Env.DEFAULT_NUVIOSTREAMS_TIMEOUT
      ),
      {
        id: 'scraperApiKey',
        name: 'Scraper API Key',
        description:
          'Optionally provide a [ScraperAPI](https://www.scraperapi.com/) API Key from',
        type: 'password',
        required: false,
        default: '',
      },
      {
        id: 'showBoxCookie',
        name: 'ShowBox Cookie',
        description:
          'The cookie for the ShowBox provider. Highly recommended to get streams greater than 9GB. Log in at [Febbox](https://www.febbox.com/) > DevTools > (Application if on Chromium) > Storage > Cookies > Copy the value of the `ui` cookie. ',
        type: 'password',
        required: false,
        default: '',
      },
      {
        id: 'showBoxRegion',
        name: 'ShowBox Region',
        description: 'The region to use for the ShowBox provider',
        type: 'select',
        required: false,
        options: regions,
        default: regions[0].value,
      },
      {
        id: 'providers',
        name: 'Providers',
        description: 'The providers to use. Leave empty to use all providers.',
        type: 'multi-select',
        options: providers,
        default: [],
      },
      {
        id: 'socials',
        name: '',
        description: '',
        type: 'socials',
        socials: [
          { id: 'github', url: 'https://github.com/tapframe/NuvioStreaming' },
          { id: 'ko-fi', url: 'https://ko-fi.com/tapframe' },
        ],
      },
    ];

    return {
      ID: 'nuvio-streams',
      NAME: 'Nuvio Streams',
      LOGO: 'https://raw.githubusercontent.com/tapframe/NuvioStreaming/main/assets/titlelogo.png',
      URL: Env.NUVIOSTREAMS_URL,
      TIMEOUT: Env.DEFAULT_NUVIOSTREAMS_TIMEOUT || Env.DEFAULT_TIMEOUT,
      USER_AGENT: Env.DEFAULT_NUVIOSTREAMS_USER_AGENT || Env.DEFAULT_USER_AGENT,
      SUPPORTED_SERVICES: [],
      DESCRIPTION: 'Free high quality streaming using multiple providers. ',
      OPTIONS: options,
      SUPPORTED_STREAM_TYPES: [constants.HTTP_STREAM_TYPE],
      SUPPORTED_RESOURCES: supportedResources,
    };
  }

  static async generateAddons(
    userData: UserData,
    options: Record<string, any>
  ): Promise<Addon[]> {
    return [this.generateAddon(userData, options)];
  }

  private static generateAddon(
    userData: UserData,
    options: Record<string, any>
  ): Addon {
    return {
      name: options.name || this.METADATA.NAME,
      manifestUrl: this.generateManifestUrl(userData, options),
      enabled: true,
      resources: options.resources || this.METADATA.SUPPORTED_RESOURCES,
      timeout: options.timeout || this.METADATA.TIMEOUT,
      preset: {
        id: '',
        type: this.METADATA.ID,
        options: options,
      },
      headers: {
        'User-Agent': this.METADATA.USER_AGENT,
      },
    };
  }

  private static generateManifestUrl(
    userData: UserData,
    options: Record<string, any>
  ) {
    let url = options.url || this.METADATA.URL;
    if (url.endsWith('/manifest.json')) {
      return url;
    }
    url = url.replace(/\/$/, '');
    const cookie = options.showBoxCookie;
    const providers = options.providers;
    const scraperApiKey = options.scraperApiKey;
    let config = [];
    if (cookie) {
      config.push(['cookie', cookie]);
    }
    if (options.showBoxRegion) {
      config.push(['region', options.showBoxRegion]);
    }
    if (providers?.length) {
      config.push(['providers', providers.join(',')]);
    }
    if (scraperApiKey) {
      config.push(['scraper_api_key', scraperApiKey]);
    }

    const configString = this.urlEncodeKeyValuePairs(config, '/', false);

    return `${url}${configString ? '/' + configString : ''}/manifest.json`;
  }
}
