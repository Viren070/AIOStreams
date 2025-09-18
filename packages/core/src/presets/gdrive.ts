import { baseOptions, Preset } from './preset.js';
import { constants, Env } from '../utils/index.js';
import {
  PresetMetadata,
  Option,
  Addon,
  UserData,
  ParsedStream,
  Stream,
} from '../db/index.js';
import { StreamParser } from '../parser/index.js';
import { GDriveAPI } from '../builtins/gdrive/index.js';
import { GoogleOAuth } from '../builtins/gdrive/api.js';

export class GDriveParser extends StreamParser {
  protected override raiseErrorIfNecessary(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): void {
    if (stream.name?.startsWith('[❌]')) {
      throw new Error(stream.description ?? 'Unknown error');
    }
  }
  protected getDuration(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): number | undefined {
    return (stream as any).duration as number | undefined;
  }
}

export class GDrivePreset extends Preset {
  static override getParser(): typeof StreamParser {
    return GDriveParser;
  }

  static override get METADATA(): PresetMetadata {
    const supportedResources = [
      constants.STREAM_RESOURCE,
      constants.CATALOG_RESOURCE,
      constants.META_RESOURCE,
    ];

    const options: Option[] = [
      {
        id: 'refreshToken',
        name: 'Authorise',
        description: 'Authorise AIOStreams to access your Google Drive',
        type: 'oauth',
        required: true,
        oauth: {
          authorisationUrl: GoogleOAuth.getAuthorisationUrl(),
          oauthResultField: {
            name: 'Refresh Token',
            description: 'The refresh token for the Google Drive API',
          },
        },
      },
      ...baseOptions(
        'Stremio GDrive',
        supportedResources,
        Env.BUILTIN_GDRIVE_TIMEOUT
      ).filter((option) => option.id !== 'url'),
      {
        id: 'metadataSource',
        name: 'Metadata Source',
        description: 'The source of metadata to use for the addon.',
        type: 'select',
        default: 'imdb',
        options: [
          {
            label: 'IMDB',
            value: 'imdb',
          },
          {
            label: 'TMDB',
            value: 'tmdb',
          },
        ],
      },
      {
        id: 'catalogSort',
        name: 'Catalog Sort',
        description:
          'The sort order of the catalog. Supports multiple values. Select the sort criteria in the order you want them to be applied. Default is "Created Time (Descending)". For more info, see the [API Reference](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list)',
        type: 'multi-select',
        default: ['createdTime_desc'],
        options: [
          { label: 'Created Time (Ascending)', value: 'createdTime_asc' },
          { label: 'Created Time (Descending)', value: 'createdTime_desc' },
          { label: 'Modified Time (Ascending)', value: 'modifiedTime_asc' },
          { label: 'Modified Time (Descending)', value: 'modifiedTime_desc' },
          {
            label: 'Modified By Me Time (Ascending)',
            value: 'modifiedByMeTime_asc',
          },
          {
            label: 'Modified By Me Time (Descending)',
            value: 'modifiedByMeTime_desc',
          },
          { label: 'Last Viewed (Ascending)', value: 'viewedByMeTime_asc' },
          { label: 'Last Viewed (Descending)', value: 'viewedByMeTime_desc' },
          {
            label: 'Shared With Me (Ascending)',
            value: 'sharedWithMeTime_asc',
          },
          {
            label: 'Shared With Me (Descending)',
            value: 'sharedWithMeTime_desc',
          },
          { label: 'Name (A-Z)', value: 'name_asc' },
          { label: 'Name (Z-A)', value: 'name_desc' },
          { label: 'Name Natural (A-Z)', value: 'name_natural_asc' },
          { label: 'Name Natural (Z-A)', value: 'name_natural_desc' },
          { label: 'Recent First', value: 'recency_desc' },
          { label: 'Oldest First', value: 'recency_asc' },
          { label: 'Starred (First)', value: 'starred_desc' },
          { label: 'Starred (Last)', value: 'starred_asc' },
          { label: 'Folders (First)', value: 'folder_desc' },
          { label: 'Folders (Last)', value: 'folder_asc' },
        ],
      },
      {
        id: 'includeAudioFiles',
        name: 'Include Audio Files',
        description: 'Whether to include audio files in the search',
        type: 'boolean',
      },
    ];

    return {
      ID: 'stremio-gdrive',
      NAME: 'Stremio GDrive',
      DESCRIPTION: 'Access content from your Google Drive in Stremio!',
      LOGO: `https://upload.wikimedia.org/wikipedia/commons/thumb/1/12/Google_Drive_icon_%282020%29.svg/1200px-Google_Drive_icon_%282020%29.svg.png`,
      URL: `${Env.INTERNAL_URL}/builtins/gdrive`,
      TIMEOUT: Env.BUILTIN_GDRIVE_TIMEOUT || Env.DEFAULT_TIMEOUT,
      USER_AGENT: Env.BUILTIN_GDRIVE_USER_AGENT || Env.DEFAULT_USER_AGENT,
      SUPPORTED_RESOURCES: supportedResources,
      SUPPORTED_STREAM_TYPES: [constants.HTTP_STREAM_TYPE],
      SUPPORTED_SERVICES: [],
      OPTIONS: options,
      BUILTIN: true,
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
    if (!options.refreshToken) {
      throw new Error(
        `${this.METADATA.NAME} requires a refresh token to be set. Please authorise the addon.`
      );
    }
    if (options.metadataSource === 'tmdb') {
      if (!userData.tmdbAccessToken && !Env.TMDB_ACCESS_TOKEN) {
        throw new Error(
          `${this.METADATA.NAME} requires a TMDB Access Token when using TMDB as the metadata source`
        );
      }
    }
    const config = this.base64EncodeJSON({
      refreshToken: options.refreshToken,
      metadataSource: options.metadataSource || 'imdb',
      includeAudioFiles: options.includeAudioFiles ?? false,
      tmdbReadAccessToken:
        options.metadataSource === 'tmdb'
          ? userData.tmdbAccessToken || Env.TMDB_ACCESS_TOKEN
          : undefined,
    });
    return `${this.METADATA.URL}/${config}/manifest.json`;
  }
}
