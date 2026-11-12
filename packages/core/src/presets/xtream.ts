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
