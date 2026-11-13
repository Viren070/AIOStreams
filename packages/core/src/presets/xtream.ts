import { baseOptions, Preset } from './preset.js';
import { constants } from '../utils/index.js';
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
import { serverBase } from '../builtins/xtream/api.js';

class XtreamStreamParser extends StreamParser {
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
    return stream.url?.includes('/timeshift/')
      ? constants.HTTP_STREAM_TYPE
      : constants.LIVE_STREAM_TYPE;
  }
}

const FILTER_OPTIONS = [
  'excludeGroups',
  'includeGroups',
  'excludeChannels',
  'includeChannels',
] as const;

export class XtreamPreset extends Preset {
  static override getParser(): typeof StreamParser {
    return XtreamStreamParser;
  }

  static override get METADATA() {
    const supportedResources = [
      constants.CATALOG_RESOURCE,
      constants.META_RESOURCE,
      constants.STREAM_RESOURCE,
    ];

    const options: Option[] = [
      ...baseOptions(
        'Xtream',
        supportedResources,
        appConfig.presets.defaultTimeout
      ).filter((option) => option.id !== 'url'),
      {
        id: 'server',
        name: 'Server',
        description:
          'The address your provider gave for its Xtream login, such as `http://example.com:8080`.',
        type: 'url',
        required: true,
      },
      {
        id: 'username',
        name: 'Username',
        description: 'Your Xtream username.',
        type: 'string',
        required: true,
      },
      {
        id: 'password',
        name: 'Password',
        description: 'Your Xtream password.',
        type: 'password',
        required: true,
      },
      {
        id: 'cleanNames',
        name: 'Clean Channel Names',
        description:
          'Strip the tag providers put before channel names, so `UK | BBC One` shows as `BBC One`. Group names are left as they are. Include and exclude keywords still match the full name.',
        type: 'boolean',
        default: false,
        showInSimpleMode: false,
      },
      {
        id: 'format',
        name: 'Stream Format',
        description:
          'Which formats channels are offered in. HLS suits most players, MPEG-TS suits players that cannot play HLS well. A format your account does not allow is skipped.',
        type: 'select',
        required: false,
        showInSimpleMode: false,
        default: 'default',
        options: [
          { label: 'Instance default', value: 'default' },
          { label: 'HLS first, then MPEG-TS', value: 'hls-first' },
          { label: 'MPEG-TS first, then HLS', value: 'ts-first' },
          { label: 'HLS only', value: 'hls' },
          { label: 'MPEG-TS only', value: 'ts' },
        ],
      },
      ...(
        [
          [
            'excludeGroups',
            'Exclude Groups',
            'Hide groups whose name contains any of these keywords, and the channels only in them.',
            'PPV, ADULT',
          ],
          [
            'includeGroups',
            'Include Groups',
            'Only show groups whose name contains one of these keywords.',
            'UK, US',
          ],
          [
            'excludeChannels',
            'Exclude Channels',
            'Hide channels whose name contains any of these keywords.',
            'RADIO, 24/7',
          ],
          [
            'includeChannels',
            'Include Channels',
            'Only show channels whose name contains one of these keywords.',
            'BBC, ITV',
          ],
        ] as const
      ).map(([id, name, summary, example]): Option => ({
        id,
        name,
        description: `${summary} Comma-separated and not case sensitive, such as \`${example}\`. Leave empty to use this instance's default, if it has one.`,
        type: 'string',
        required: false,
        showInSimpleMode: false,
        emptyIsUndefined: true,
      })),
    ];

    return {
      ID: 'xtream',
      NAME: 'Xtream',
      URL: [`${appConfig.bootstrap.internalUrl}/builtins/xtream`],
      TIMEOUT: appConfig.presets.defaultTimeout,
      USER_AGENT: appConfig.http.defaultUserAgent,
      SUPPORTED_SERVICES: [],
      DESCRIPTION:
        "Live TV channels, guide and catch-up from an IPTV provider's Xtream login.",
      OPTIONS: options,
      SUPPORTED_STREAM_TYPES: [constants.LIVE_STREAM_TYPE],
      SUPPORTED_RESOURCES: supportedResources,
      BUILTIN: true,
    };
  }

  private static splitList(value: unknown): string[] {
    return typeof value === 'string'
      ? value
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean)
      : [];
  }

  static async generateAddons(
    userData: UserData,
    options: Record<string, any>
  ): Promise<Addon[]> {
    if (!options.server || !options.username || !options.password)
      throw new Error(
        `${this.METADATA.NAME} needs the server, username and password of your Xtream login.`
      );
    try {
      serverBase(options.server);
    } catch {
      throw new Error(
        `${this.METADATA.NAME} needs an http or https server address.`
      );
    }
    const config = this.base64EncodeJSON(
      {
        server: options.server,
        username: options.username,
        password: options.password,
        ...(options.cleanNames === true && { cleanNames: true }),
        ...(options.format &&
          options.format !== 'default' && { format: options.format }),
        ...Object.fromEntries(
          FILTER_OPTIONS.map((id) => [id, this.splitList(options[id])])
        ),
      },
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
