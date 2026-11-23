import {
  ParsedFile,
  ParsedStream,
  PresetMetadata,
  Stream,
} from '../db/index.js';
import { EasynewsPreset, EasynewsParser } from './easynews.js';
import { constants } from '../utils/index.js';
import { baseOptions } from './preset.js';
import { config as appConfig } from '../config/index.js';
import { StreamParser, getRegexForTextAfterEmojis } from '../parser/index.js';
import { arrayMerge } from '../parser/merge.js';

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
    const regex = getRegexForTextAfterEmojis(['🌐']);
    const langs = stream.description?.match(regex)?.[1];
    return (
      langs
        ?.split(',')
        ?.map((lang) => this.convertISO6392ToLanguage(lang.trim()))
        .filter((lang) => lang !== undefined) || []
    );
  }

  protected override getParsedFile(
    stream: Stream,
    parsedStream: ParsedStream
  ): ParsedFile | undefined {
    const parsedFile = super.getParsedFile(stream, parsedStream);
    if (!parsedFile) {
      return undefined;
    }

    // Easynews++ emits a `💬` subtitle-language line alongside the `🌐` audio
    // line, using the same comma-separated ISO 639-2 codes. Parse it the same way
    // getLanguages() handles audio, and merge into the file's subtitle languages.
    const regex = getRegexForTextAfterEmojis(['💬']);
    const subtitles =
      stream.description
        ?.match(regex)?.[1]
        ?.split(',')
        ?.map((lang) => this.convertISO6392ToLanguage(lang.trim()))
        .filter((lang) => lang !== undefined) || [];

    if (subtitles.length > 0) {
      parsedFile.subtitles = arrayMerge(parsedFile.subtitles, subtitles);
    }

    return parsedFile;
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
          id: 'preferredLanguage',
          name: 'Preferred Audio Language',
          description:
            'Used to find content with localized titles in the preferred language',
          type: 'select',
          required: false,
          default: '',
          options: [
            { label: 'No preference', value: '' },
            { label: 'English', value: 'eng' },
            { label: 'Deutsch (German)', value: 'ger' },
            { label: 'Español (Spanish)', value: 'spa' },
            { label: 'Français (French)', value: 'fre' },
            { label: 'Italiano (Italian)', value: 'ita' },
            { label: '日本語 (Japanese)', value: 'jpn' },
            { label: 'Português (Portuguese)', value: 'por' },
            { label: 'Русский (Russian)', value: 'rus' },
            { label: '한국어 (Korean)', value: 'kor' },
            { label: '中文 (Chinese)', value: 'chi' },
            { label: 'Nederlands (Dutch)', value: 'dut' },
            { label: 'Română (Romanian)', value: 'rum' },
            { label: 'Български (Bulgarian)', value: 'bul' },
            { label: 'Arabic (العربية)', value: 'ara' },
            { label: 'Czech (Čeština)', value: 'cze' },
            { label: 'Danish (Dansk)', value: 'dan' },
            { label: 'Finnish (Suomi)', value: 'fin' },
            { label: 'Greek (Ελληνικά)', value: 'gre' },
            { label: 'Hebrew (עברית)', value: 'heb' },
            { label: 'Hindi (हिन्दी)', value: 'hin' },
            { label: 'Hungarian (Magyar)', value: 'hun' },
            { label: 'Icelandic (Íslenska)', value: 'ice' },
            { label: 'Indonesian (Bahasa Indonesia)', value: 'ind' },
            { label: 'Malay (Bahasa Melayu)', value: 'may' },
            { label: 'Norwegian (Norsk)', value: 'nor' },
            { label: 'Persian (فارسی)', value: 'per' },
            { label: 'Polish (Polski)', value: 'pol' },
            { label: 'Swedish (Svenska)', value: 'swe' },
            { label: 'Thai (ไทย)', value: 'tha' },
            { label: 'Turkish (Türkçe)', value: 'tur' },
            { label: 'Ukrainian (Українська)', value: 'ukr' },
            { label: 'Vietnamese (Tiếng Việt)', value: 'vie' },
          ],
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
      preferredLanguage: options.preferredLanguage ?? '',
      sortingPreference: 'quality_first',
      showQualities: '4k,1080p,720p,480p',
      maxResultsPerQuality: '',
      maxFileSize: '',
    });
  }
}
