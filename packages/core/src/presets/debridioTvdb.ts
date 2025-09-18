import { Addon, Option, UserData } from '../db/index.js';
import { CacheKeyRequestOptions, Preset, baseOptions } from './preset.js';
import { constants, Env } from '../utils/index.js';
import {
  debridioSocialOption,
  debridioApiKeyOption,
  debridioLogo,
} from './debridio.js';

export class DebridioTvdbPreset extends Preset {
  static override get METADATA() {
    const supportedResources = [
      constants.CATALOG_RESOURCE,
      constants.META_RESOURCE,
    ];

    const options: Option[] = [
      ...baseOptions(
        'Debridio TVDB',
        supportedResources,
        Env.DEFAULT_DEBRIDIO_TVDB_TIMEOUT
      ),
      debridioApiKeyOption,
      debridioSocialOption,
    ];

    return {
      ID: 'debridio-tvdb',
      NAME: 'Debridio TVDB',
      LOGO: debridioLogo,
      URL: Env.DEBRIDIO_TVDB_URL,
      TIMEOUT: Env.DEFAULT_DEBRIDIO_TVDB_TIMEOUT || Env.DEFAULT_TIMEOUT,
      USER_AGENT:
        Env.DEFAULT_DEBRIDIO_TVDB_USER_AGENT || Env.DEFAULT_USER_AGENT,
      SUPPORTED_SERVICES: [],
      DESCRIPTION: 'Catalogs for the Debridio TVDB',
      OPTIONS: options,
      SUPPORTED_STREAM_TYPES: [],
      SUPPORTED_RESOURCES: supportedResources,
    };
  }

  static async generateAddons(
    userData: UserData,
    options: Record<string, any>
  ): Promise<Addon[]> {
    if (!options.url && !options.debridioApiKey) {
      throw new Error(
        'To access the Debridio addons, you must provide your Debridio API Key'
      );
    }
    return [this.generateAddon(userData, options)];
  }

  private static generateAddon(
    userData: UserData,
    options: Record<string, any>
  ): Addon {
    let url = this.METADATA.URL;
    if (options.url?.endsWith('/manifest.json')) {
      url = options.url;
    } else {
      let baseUrl = this.METADATA.URL;
      if (options.url) {
        baseUrl = new URL(options.url).origin;
      }
      // remove trailing slash
      baseUrl = baseUrl.replace(/\/$/, '');
      const config = this.base64EncodeJSON({
        api_key: options.debridioApiKey,
        language: 'eng',
      });
      url = `${baseUrl}/${config}/manifest.json`;
    }
    return {
      name: options.name || this.METADATA.NAME,
      manifestUrl: url,
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

  static override getCacheKey(
    options: CacheKeyRequestOptions
  ): string | undefined {
    const { resource, type, id, options: presetOptions, extras } = options;
    try {
      if (new URL(presetOptions.url).pathname.endsWith('/manifest.json')) {
        return undefined;
      }
      if (new URL(presetOptions.url).origin !== this.METADATA.URL) {
        return undefined;
      }
    } catch {}
    // allows cache key to be shared across different debridio users.
    let cacheKey = `${this.METADATA.ID}-${resource}-${type}-${id}-${extras}`;
    if (resource === 'manifest') {
      cacheKey += `-${presetOptions.debridioApiKey}`;
    }
    return cacheKey;
  }
}
