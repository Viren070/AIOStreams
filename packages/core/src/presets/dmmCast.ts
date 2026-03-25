import {
  Addon,
  Option,
  UserData,
  ParsedStream,
  Stream,
  AIOStream,
} from '../db/index.js';
import { Preset, baseOptions } from './preset.js';
import { constants, Env, RESOURCES, ServiceId } from '../utils/index.js';
import { StreamParser } from '../parser/index.js';

class DMMCastStreamParser extends StreamParser {
  protected override getMessage(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): string | undefined {
    if (stream.description?.includes('Cast a file')) {
      currentParsedStream.filename = undefined;
      return stream.description;
    }
    return undefined;
  }

  protected getService(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): ParsedStream['service'] | undefined {
    const debrid = /(TB|RD)/g.exec(`${stream.name} - ${stream.description}`);
    const map: Record<string, ServiceId> = {
      RD: 'realdebrid',
      TB: 'torbox',
    };
    if (debrid) {
      return {
        id: map[debrid[1]],
        cached: true,
      };
    }
    return undefined;
  }

  protected override getInLibrary(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): boolean {
    const lastLine = stream.description?.split('\n')?.at(-1)?.trim();
    if (lastLine?.includes('Yours')) {
      return true;
    }
    return false;
  }
}

export class DMMCastPreset extends Preset {
  static override getParser(): typeof StreamParser {
    return DMMCastStreamParser;
  }

  static override get METADATA() {
    const supportedResources = [constants.STREAM_RESOURCE];
    const options: Option[] = [
      {
        id: 'name',
        name: 'Name',
        description: 'What to call this addon',
        type: 'string',
        required: true,
        default: 'DMM Cast',
      },
      {
        id: 'installationUrl',
        name: 'Installation URL',
        description:
          'Provide the Unique Installation URL for your DMM Cast addon, available [here](https://debridmediamanager.com/stremio)',
        type: 'password',
        required: true,
      },
      {
        id: 'timeout',
        name: 'Timeout (ms)',
        description: 'The timeout for this addon',
        type: 'number',
        default: Env.DEFAULT_DMM_CAST_TIMEOUT || Env.DEFAULT_TIMEOUT,
        constraints: {
          min: Env.MIN_TIMEOUT,
          max: Env.MAX_TIMEOUT,
          forceInUi: false,
        },
      },
      {
        id: 'resources',
        name: 'Resources',
        description:
          'Optionally override the resources that are fetched from this addon ',
        type: 'multi-select',
        required: false,
        default: undefined,
        options: RESOURCES.map((resource) => ({
          label: resource,
          value: resource,
        })),
        showInSimpleMode: false,
      },
      {
        id: 'socials',
        name: '',
        description: '',
        type: 'socials',
        socials: [{ id: 'website', url: 'https://debridmediamanager.com' }],
      },
    ];

    return {
      ID: 'dmm-cast',
      NAME: 'DMM Cast',
      LOGO: 'https://static.debridmediamanager.com/dmmcast.png',
      URL: '',
      TIMEOUT: Env.DEFAULT_DMM_CAST_TIMEOUT || Env.DEFAULT_TIMEOUT,
      USER_AGENT: Env.DEFAULT_DMM_CAST_USER_AGENT || Env.DEFAULT_USER_AGENT,
      SUPPORTED_SERVICES: [],
      DESCRIPTION:
        'Access streams casted from [DMM](https://debridmediamanager.com) by you or other users',
      OPTIONS: options,
      SUPPORTED_STREAM_TYPES: [],
      SUPPORTED_RESOURCES: supportedResources,
    };
  }

  static async generateAddons(
    userData: UserData,
    options: Record<string, any>
  ): Promise<Addon[]> {
    if (!options.installationUrl.endsWith('/manifest.json')) {
      throw new Error('Invalid installation URL');
    }
    return [this.generateAddon(userData, options)];
  }

  private static generateAddon(
    userData: UserData,
    options: Record<string, any>
  ): Addon {
    return {
      name: options.name || this.METADATA.NAME,
      manifestUrl: options.installationUrl,
      enabled: true,
      library: false,
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
}
