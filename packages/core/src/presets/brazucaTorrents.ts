import { Addon, Option, UserData } from '../db/index.js';
import { baseOptions, Preset } from './preset.js';
import { Env } from '../utils/index.js';
import { constants } from '../utils/index.js';

export class BrazucaTorrentsPreset extends Preset {
  static override get METADATA() {
    const supportedResources = [constants.STREAM_RESOURCE];

    const options: Option[] = [
      ...baseOptions(
        'Brazuca Torrents',
        supportedResources,
        Env.DEFAULT_BRAZUCA_TORRENTS_TIMEOUT
      ),
    ];

    return {
      ID: 'brazuca-torrents',
      NAME: 'Brazuca Torrents',
      LOGO: 'https://i.imgur.com/KVpfrAk.png',
      URL: Env.BRAZUCA_TORRENTS_URL,
      TIMEOUT: Env.DEFAULT_BRAZUCA_TORRENTS_TIMEOUT || Env.DEFAULT_TIMEOUT,
      USER_AGENT:
        Env.DEFAULT_BRAZUCA_TORRENTS_USER_AGENT || Env.DEFAULT_USER_AGENT,
      SUPPORTED_SERVICES: [],
      DESCRIPTION:
        'Fornece streams de filmes e series dublados de provedores de torrent',
      OPTIONS: options,
      SUPPORTED_STREAM_TYPES: [constants.P2P_STREAM_TYPE],
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
    const baseUrl = options.url
      ? new URL(options.url).origin
      : this.METADATA.URL;

    const url = options.url?.endsWith('/manifest.json')
      ? options.url
      : `${baseUrl}/manifest.json`;

    return {
      name: options.name || this.METADATA.NAME,
      manifestUrl: url,
      enabled: true,
      resources: options.resources || this.METADATA.SUPPORTED_RESOURCES,
      identifier: 'p2p',
      displayIdentifier: 'P2P',
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
