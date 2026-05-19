import { ParsedStream, PresetMetadata, Stream } from '../db/index.js';
import { EasynewsPreset, EasynewsParser } from './easynews.js';
import { constants } from '../utils/index.js';
import { baseOptions } from './preset.js';
import { config as appConfig } from '../config/index.js';
import { StreamParser } from '../parser/index.js';

class EasynewsPlusPlusParser extends EasynewsParser {
  protected override get ageRegex(): RegExp {
    return /📅\s*(\d+[a-zA-Z])/;
  }

  protected get indexerRegex(): RegExp | undefined {
    return undefined;
  }

  protected override getLanguages(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): string[] {
    const regex = this.getRegexForTextAfterEmojis(['🌐']);
    const langs = stream.description?.match(regex)?.[1];
    return (
      langs
        ?.split(',')
        ?.map((lang) => this.convertISO6392ToLanguage(lang.trim()))
        .filter((lang) => lang !== undefined) || []
    );
  }
}

export class EasynewsPlusPlusPreset extends EasynewsPreset {
  static override getParser(): typeof StreamParser {
    return EasynewsPlusPlusParser;
  }

  static override get METADATA(): PresetMetadata {
    return {
      ...super.METADATA,
      ID: 'easynewsPlusPlus',
      NAME: 'Easynews++',
      DESCRIPTION: 'Easynews++ provides content from Easynews',
      URL: appConfig.presets.easynewsPlusPlus.url,
      TIMEOUT:
        appConfig.presets.easynewsPlusPlus.defaultTimeout ??
        appConfig.presets.defaultTimeout,
      USER_AGENT:
        appConfig.presets.easynewsPlusPlus.defaultUserAgent ??
        appConfig.http.defaultUserAgent,
      OPTIONS: [
        ...baseOptions(
          'Easynews++',
          super.METADATA.SUPPORTED_RESOURCES,
          appConfig.presets.easynewsPlusPlus.defaultTimeout ??
            appConfig.presets.defaultTimeout
        ),
        {
          id: 'mediaTypes',
          name: 'Media Types',
          description:
            'Limits this addon to the selected media types for streams. For example, selecting "Movie" means this addon will only be used for movie streams (if the addon supports them). Leave empty to allow all.',
          type: 'multi-select',
          required: false,
          options: [
            { label: 'Movie', value: 'movie' },
            { label: 'Series', value: 'series' },
            { label: 'Anime', value: 'anime' },
          ],
          default: [],
          showInSimpleMode: false,
        },
        {
          id: 'strictTitleMatching',
          name: 'Strict Title Matching',
          description:
            "Whether to filter out results that don't match the title exactly",
          type: 'boolean',
          required: true,
          default: false,
        },
        {
          id: 'socials',
          name: '',
          description: '',
          type: 'socials',
          socials: [
            {
              id: 'github',
              url: 'https://github.com/panteLx/easynews-plus-plus',
            },
            {
              id: 'buymeacoffee',
              url: 'https://buymeacoffee.com/pantel',
            },
          ],
        },
      ],
    };
  }

  protected static override generateConfig(
    easynewsCredentials: {
      username: string;
      password: string;
    },
    options: Record<string, any>
  ): string {
    return this.urlEncodeJSON({
      uiLanguage: 'eng',
      username: easynewsCredentials.username,
      password: easynewsCredentials.password,
      strictTitleMatching: options.strictTitleMatching ? 'on' : 'off',
      baseUrl: options.url
        ? new URL(options.url).origin
        : (appConfig.presets.easynewsPlusPlus.publicUrl ?? this.DEFAULT_URL),
      preferredLanguage: '',
      sortingPreference: 'quality_first',
      showQualities: '4k,1080p,720p,480p',
      maxResultsPerQuality: '',
      maxFileSize: '',
    });
  }
}
