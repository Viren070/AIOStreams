import { baseOptions, Preset } from './preset.js';
import { constants, formatDurationAsText } from '../utils/index.js';
import { config as appConfig } from '../config/index.js';
import {
  Addon,
  Option,
  ParsedFile,
  ParsedStream,
  Stream,
  UserData,
} from '../db/index.js';
import { StreamParser } from '../parser/index.js';
import { MAX_CHANNELS, isHttpUrl } from '../builtins/m3u/playlist.js';

class M3uStreamParser extends StreamParser {
  protected override getParsedFile(): ParsedFile | undefined {
    return undefined;
  }

  protected override getFilename(): string | undefined {
    return undefined;
  }

  protected override getMessage(stream: Stream): string | undefined {
    return stream.description ?? undefined;
  }

  protected override getStreamType(stream: Stream): ParsedStream['type'] {
    return stream.description?.startsWith('Catch-up')
      ? constants.HTTP_STREAM_TYPE
      : constants.LIVE_STREAM_TYPE;
  }
}

export class M3uPreset extends Preset {
  static override getParser(): typeof StreamParser {
    return M3uStreamParser;
  }

  static override get METADATA() {
    const supportedResources = [
      constants.CATALOG_RESOURCE,
      constants.META_RESOURCE,
      constants.STREAM_RESOURCE,
    ];

    const m3u = appConfig.builtins.m3u;
    const mb = (bytes: number) => `${Math.round(bytes / 1_000_000)} MB`;
    const within = (ms: number) => formatDurationAsText(ms / 1000);

    const options: Option[] = [
      ...baseOptions(
        'M3U',
        supportedResources,
        appConfig.presets.defaultTimeout
      ).filter((option) => option.id !== 'url'),
      {
        id: 'playlist',
        name: 'Playlist',
        description: `The address of an M3U playlist. [Free-TV](https://github.com/Free-TV/IPTV) and [iptv-org](https://github.com/iptv-org/iptv) list free-to-air channels. Playlists must download within ${within(m3u.timeout)} and stay under ${mb(m3u.playlistMaxBytes)}; up to ${MAX_CHANNELS.toLocaleString('en-US')} channels are read. With an Xtream login, use the Xtream addon instead. Changes show within ${formatDurationAsText(m3u.lineupTtl)}.`,
        type: 'url',
        required: true,
      },
      {
        id: 'guides',
        name: 'Guides',
        description: `XMLTV guide addresses, separated by commas, in place of the playlist's own. Up to ${m3u.guideUrls} are read, each within ${within(m3u.guideTimeout)} and under ${mb(m3u.guideMaxBytes)}. A large guide's programmes can take a few minutes to appear.`,
        type: 'string',
        required: false,
      },
    ];

    return {
      ID: 'm3u',
      NAME: 'M3U',
      URL: [`${appConfig.bootstrap.internalUrl}/builtins/m3u`],
      TIMEOUT: appConfig.presets.defaultTimeout,
      USER_AGENT: appConfig.http.defaultUserAgent,
      SUPPORTED_SERVICES: [],
      DESCRIPTION:
        'Live TV channels, guide and catch-up from an IPTV M3U playlist.',
      OPTIONS: options,
      SUPPORTED_STREAM_TYPES: [constants.LIVE_STREAM_TYPE],
      SUPPORTED_RESOURCES: supportedResources,
      BUILTIN: true,
    };
  }

  static async generateAddons(
    userData: UserData,
    options: Record<string, any>
  ): Promise<Addon[]> {
    const playlist = String(options.playlist ?? '').trim();
    if (!isHttpUrl(playlist))
      throw new Error(
        `${this.METADATA.NAME} needs an http or https playlist address.`
      );
    const guides = String(options.guides ?? '')
      .split(/[\s,]+/)
      .filter(Boolean);
    if (guides.some((guide) => !isHttpUrl(guide)))
      throw new Error(
        `${this.METADATA.NAME} needs http or https guide addresses.`
      );
    const config = this.base64EncodeJSON(
      { url: playlist, ...(guides.length && { guides }) },
      'urlSafe'
    );
    return [
      {
        name: options.name || this.METADATA.NAME,
        manifestUrl: `${this.DEFAULT_URL}/${config}/manifest.json`,
        enabled: true,
        library: false,
        resources: options.resources || this.METADATA.SUPPORTED_RESOURCES,
        timeout: options.timeout || this.METADATA.TIMEOUT,
        resultPassthrough: true,
        preset: {
          id: '',
          type: this.METADATA.ID,
          options: options,
        },
        headers: {
          'User-Agent': this.METADATA.USER_AGENT,
        },
      },
    ];
  }
}
