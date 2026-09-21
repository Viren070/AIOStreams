import {
  Addon,
  Option,
  ParsedFile,
  ParsedStream,
  PresetMetadata,
  Stream,
  UserData,
} from '../db/index.js';
import { Preset } from './preset.js';
import {
  FileParser,
  StreamParser,
  getRegexForTextAfterEmojis,
} from '../parser/index.js';
import { arrayMerge } from '../parser/merge.js';
import { appConfig, constants, normaliseLanguage } from '../utils/index.js';

const TITLE_LINE = getRegexForTextAfterEmojis(['🍿', '📡']);
const SOURCE_LINE = getRegexForTextAfterEmojis(['🛰️']);
const SPECS_LINE = getRegexForTextAfterEmojis(['🎞️']);
const AUDIO_LINE = getRegexForTextAfterEmojis(['🎧']);
const SUBTITLE_LINE = getRegexForTextAfterEmojis(['📝']);
const BITRATE = /(?:~\s*)?([\d.]+)\s*([km])bps/i;

const PAD_MARKER = '|^|.pad-';

function unpad(filename: string): string {
  const marker = filename.indexOf(PAD_MARKER);
  if (marker === -1) return filename;
  const padded = filename.slice(0, marker);
  for (let length = Math.floor(padded.length / 2); length > 0; length--) {
    const upper = padded.slice(-2 * length, -length);
    const lower = padded.slice(-length);
    if (upper !== lower && upper.toLowerCase() === lower) {
      return padded.slice(0, -2 * length);
    }
  }
  return padded;
}

function line(
  description: string | null | undefined,
  marker: RegExp,
  label?: string
): string | undefined {
  const value = description?.match(marker)?.[1]?.trim();
  if (!value) return undefined;
  return (
    (label && value.startsWith(label)
      ? value.slice(label.length).trim()
      : value) || undefined
  );
}

function languages(...values: (string | undefined)[]): string[] {
  return values
    .flatMap((value) => value?.split(',') ?? [])
    .map((entry) => toLanguage(entry))
    .filter((language) => language !== undefined);
}

// Some sources qualify a language with a variant ("English - SDH") or index a
// duplicate track ("Spanish 2"); both still name the language itself.
function toLanguage(entry: string): string | undefined {
  const value = entry.trim();
  return (
    normaliseLanguage(value) ??
    normaliseLanguage(value.replace(/\s*[-(].*$/, '').replace(/\s+\d+$/, ''))
  );
}

/**
 * Reads PenguPlay's default stream templates, which render as:
 *
 *   🐧 PenguPlay <resolution> • <provider>
 *
 *   🍿 <title> | 📡 <title> • S01E01
 *   🎞️ <spec> • <spec> • … • ~<n> Mbps
 *   🛰️ Source: <provider>
 *   💾 <size>
 *   🎧 Audio: <language>, <language>
 *   📝 Subtitles: <language>, … | 🙊 No included subtitles
 */
class PenguPlayStreamParser extends StreamParser {
  override get errorRegexes() {
    return [
      ...(super.errorRegexes ?? []),
      {
        pattern: /authentication is missing, invalid, or revoked/i,
        message:
          'PenguPlay authentication is missing, invalid, or revoked. Reinstall PenguPlay from pengu.uk and update the Manifest URL',
      },
    ];
  }

  // A link with nothing to play is the donation notice, not a result.
  protected override isInfoStream(stream: Stream): string | undefined {
    if (!stream.url && stream.externalUrl) {
      return stream.description || stream.name || undefined;
    }
  }

  protected override getIndexer(
    stream: Stream,
    _currentParsedStream: ParsedStream
  ): string | undefined {
    return line(stream.description, SOURCE_LINE, 'Source:');
  }

  protected override getFilename(
    stream: Stream,
    _currentParsedStream: ParsedStream
  ): string | undefined {
    const hint = stream.behaviorHints?.filename;
    // HLS sources have no release to name, so their hint is pad and nothing
    // else; the title line is then all that names the content.
    return (
      (hint ? unpad(hint) : undefined) ||
      line(stream.description, TITLE_LINE) ||
      stream.description?.split('\n')[0]?.trim()
    );
  }

  // PenguPlay states the bitrate outright; there is no duration to derive it from.
  protected override getBitrate(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): number | undefined {
    const match = stream.description?.match(BITRATE);
    if (!match) return super.getBitrate(stream, currentParsedStream);
    const scale = match[2].toLowerCase() === 'k' ? 1_000 : 1_000_000;
    return Math.round(Number(match[1]) * scale);
  }

  protected override getLanguages(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): string[] {
    return arrayMerge(
      super.getLanguages(stream, currentParsedStream),
      languages(line(stream.description, AUDIO_LINE, 'Audio:'))
    );
  }

  protected override getSubtitles(
    stream: Stream,
    _currentParsedStream: ParsedStream
  ): string[] {
    return arrayMerge(
      languages(line(stream.description, SUBTITLE_LINE, 'Subtitles:')),
      this.attachedSubtitleLanguages(stream)
    );
  }

  protected override getParsedFile(
    stream: Stream,
    parsedStream: ParsedStream
  ): ParsedFile | undefined {
    const parsedFile = super.getParsedFile(stream, parsedStream);
    if (!parsedFile) return parsedFile;

    const specs = line(stream.description, SPECS_LINE);
    const parsedSpecs = specs ? FileParser.parse(specs) : undefined;
    if (parsedSpecs) {
      // The filename wins on scalars: PenguPlay labels the odd 1080p release
      // 4K. It is still the only media info an obfuscated filename has.
      parsedFile.resolution ||= parsedSpecs.resolution;
      parsedFile.quality ||= parsedSpecs.quality;
      parsedFile.encode ||= parsedSpecs.encode;
      parsedFile.container ||= parsedSpecs.container;
      parsedFile.visualTags = arrayMerge(
        parsedFile.visualTags,
        parsedSpecs.visualTags
      );
      parsedFile.audioTags = arrayMerge(
        parsedFile.audioTags,
        parsedSpecs.audioTags
      );
      parsedFile.audioChannels = arrayMerge(
        parsedFile.audioChannels,
        parsedSpecs.audioChannels
      );
      parsedFile.mediaInfoQuality ??= 'addon';
    }

    const track = /·\s*(sub|dub)\s*$/i.exec(parsedStream.indexer ?? '')?.[1];
    if (track?.toLowerCase() === 'dub') {
      parsedFile.dubbed = true;
      parsedFile.languages = arrayMerge(parsedFile.languages, ['Dubbed']);
    } else if (track) {
      parsedFile.subbed = true;
    }

    return parsedFile;
  }
}

export class PenguPlayPreset extends Preset {
  static override getParser(): typeof StreamParser {
    return PenguPlayStreamParser;
  }

  static override get METADATA(): PresetMetadata {
    const supportedResources = [
      constants.STREAM_RESOURCE,
      constants.SUBTITLES_RESOURCE,
      constants.META_RESOURCE,
      constants.CATALOG_RESOURCE,
    ];

    const options: Option[] = [
      {
        id: 'name',
        name: 'Name',
        description: 'What to call this addon',
        type: 'string',
        required: true,
        default: 'PenguPlay',
      },
      {
        id: 'manifestUrl',
        name: 'Manifest URL',
        description:
          'PenguPlay signs you in through its own configure page, so it cannot be set up from here. Install it at [pengu.uk](https://pengu.uk), copy the Manifest URL it gives you, and paste it here.',
        type: 'url',
        required: true,
      },
      {
        id: 'formatterAlert',
        name: 'Keep PenguPlay on its default format',
        description:
          'This preset reads the stream name and description PenguPlay writes by default. Leave the Custom Formatter set to default in your PenguPlay config, otherwise the source, quality, size and language of results may be lost.',
        type: 'alert',
        intent: 'warning-basic',
      },
      {
        id: 'timeout',
        name: 'Timeout (ms)',
        description: 'The timeout for this addon',
        type: 'number',
        required: true,
        default: appConfig.presets.defaultTimeout,
        constraints: {
          min: appConfig.userLimits.timeouts.minTimeout,
          max: appConfig.userLimits.timeouts.maxTimeout,
          forceInUi: false,
        },
      },
      {
        id: 'resources',
        name: 'Resources',
        description: 'Optionally override the resources to use ',
        type: 'multi-select',
        required: false,
        showInSimpleMode: false,
        default: supportedResources,
        options: supportedResources.map((resource) => ({
          label: constants.RESOURCE_LABELS[resource],
          value: resource,
        })),
      },
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
        id: 'socials',
        name: '',
        description: '',
        type: 'socials',
        socials: [
          { id: 'website', url: 'https://pengu.uk' },
          { id: 'donate', url: 'https://pengu.uk/donate' },
        ],
      },
    ];

    return {
      ID: 'penguplay',
      NAME: 'PenguPlay',
      DESCRIPTION:
        'Streams movies, series and live TV from public hosts, with configurable provider and quality filters.',
      LOGO: 'https://pengu.uk/penguplay-icon.png',
      URL: [],
      TIMEOUT: appConfig.presets.defaultTimeout,
      USER_AGENT: appConfig.http.defaultUserAgent,
      SUPPORTED_SERVICES: [],
      SUPPORTED_RESOURCES: supportedResources,
      SUPPORTED_STREAM_TYPES: [
        constants.HTTP_STREAM_TYPE,
        constants.LIVE_STREAM_TYPE,
      ],
      CATEGORY: constants.PresetCategory.STREAMS,
      OPTIONS: options,
    };
  }

  static async generateAddons(
    userData: UserData,
    options: Record<string, any>
  ): Promise<Addon[]> {
    let manifestUrl = options.manifestUrl;
    try {
      manifestUrl = new URL(manifestUrl);
    } catch (error) {
      throw new Error(
        `${options.name} has an invalid Manifest URL. It must be a valid link to a manifest.json`
      );
    }
    if (!manifestUrl.pathname.endsWith('/manifest.json')) {
      throw new Error(
        `${options.name} has an invalid Manifest URL. It must be a valid link to a manifest.json`
      );
    }
    return [this.generateAddon(userData, options)];
  }

  private static generateAddon(
    userData: UserData,
    options: Record<string, any>
  ): Addon {
    return {
      name: options.name || this.METADATA.NAME,
      manifestUrl: options.manifestUrl,
      enabled: true,
      mediaTypes: options.mediaTypes || [],
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
