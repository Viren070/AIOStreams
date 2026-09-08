import {
  Option,
  ParsedFile,
  ParsedStream,
  Stream,
  UserData,
} from '../db/index.js';
import {
  StreamParser,
  getLanguagesAfterMarker,
  getRegexForTextAfterEmojis,
} from '../parser/index.js';
import { matchPattern, matchMultiplePatterns } from '../parser/file.js';
import { PARSE_REGEX } from '../parser/regex.js';
import { constants, ServiceId } from '../utils/index.js';
import { Preset } from './preset.js';

export const stremthruSpecialCases: Partial<
  Record<ServiceId, (credentials: any) => any>
> = {
  [constants.OFFCLOUD_SERVICE]: (credentials: any) =>
    `${credentials.email}:${credentials.password}`,
  [constants.PIKPAK_SERVICE]: (credentials: any) =>
    `${credentials.email}:${credentials.password}`,
  [constants.STREMTHRU_NEWZ_SERVICE]: (credentials: any) => credentials,
};

export class StremThruStreamParser extends StreamParser {
  protected override isPrivate(
    stream: Stream,
    _currentParsedStream: ParsedStream
  ): boolean | undefined {
    return stream.name?.includes('🔑') ? true : false;
  }

  protected get filenameRegex(): RegExp | undefined {
    return getRegexForTextAfterEmojis(['📄', '📁']);
  }

  protected override getFolderSize(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): number | undefined {
    let folderSize = this.calculateBytesFromSizeString(
      stream.description ?? '',
      /📦\s*(\d+(\.\d+)?)\s?(KB|MB|GB|TB)/i
    );
    return folderSize;
  }

  protected override get indexerEmojis(): string[] {
    return ['🔍'];
  }

  private getProbedBitrate(stream: Stream): number | undefined {
    const match = stream.description?.match(
      /〽️\s*([\d.]+)\s*(B|KB|MB)\/s/i
    );
    if (!match) return undefined;
    const value = parseFloat(match[1]);
    const unit = match[2].toUpperCase();
    const bytesPerSecond =
      unit === 'MB' ? value * 1_000_000 : unit === 'KB' ? value * 1_000 : value;
    return Math.round(bytesPerSecond * 8);
  }

  protected override getBitrate(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): number | undefined {
    return (
      this.getProbedBitrate(stream) ??
      super.getBitrate(stream, currentParsedStream)
    );
  }

  // 🎙️/💬 are handled in getParsedFileMergeOverrides. 🌐 is ambiguous (probe
  // vs. filename guess), so fall back to the generic scan for it.
  protected override getLanguages(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): string[] {
    if (!stream.description?.includes('🌐')) return [];
    return super.getLanguages(stream, currentParsedStream);
  }

  // Emoji layout mirrors StremThru's own rendering, see:
  // https://github.com/MunifTanjim/stremthru/blob/0.103.2/internal/stremio/transformer/stream_template_default.go
  protected getParsedFileMergeOverrides(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): Partial<ParsedFile> {
    const overrides: Partial<ParsedFile> = {};

    const audioLangs = getLanguagesAfterMarker(stream.description, '🎙️');
    if (audioLangs && audioLangs.length > 0) {
      overrides.languages = audioLangs;
      overrides.mediaInfoQuality = 'probe';
    }

    const subtitleLangs = getLanguagesAfterMarker(stream.description, '💬');
    if (subtitleLangs && subtitleLangs.length > 0) {
      overrides.subtitles = subtitleLangs;
      overrides.mediaInfoQuality = 'probe';
    }

    const codecText = stream.description?.match(
      getRegexForTextAfterEmojis(['🎞️'])
    )?.[1];
    if (codecText) {
      const encode = matchPattern(codecText, PARSE_REGEX.encodes);
      if (encode) overrides.encode = encode;
    }

    const hdrText = stream.description?.match(
      getRegexForTextAfterEmojis(['📺'])
    )?.[1];
    if (hdrText) {
      const visualTags = matchMultiplePatterns(hdrText, PARSE_REGEX.visualTags);
      if (visualTags.length > 0) overrides.visualTags = visualTags;
    }

    const audioLine = stream.description?.match(
      getRegexForTextAfterEmojis(['🎧'])
    )?.[1];
    if (audioLine) {
      const audioTags = matchMultiplePatterns(audioLine, PARSE_REGEX.audioTags);
      if (audioTags.length > 0) overrides.audioTags = audioTags;
      const audioChannels = matchMultiplePatterns(
        audioLine.replace(/\bstereo\b/gi, '2.0'),
        PARSE_REGEX.audioChannels
      );
      if (audioChannels.length > 0) overrides.audioChannels = audioChannels;
    }

    if (this.getProbedBitrate(stream) !== undefined) {
      overrides.mediaInfoQuality = 'probe';
    }

    return overrides;
  }
}

export class StremThruPreset extends Preset {
  public static readonly supportedServices: ServiceId[] = [
    constants.ALLDEBRID_SERVICE,
    constants.DEBRIDER_SERVICE,
    constants.DEBRIDLINK_SERVICE,
    constants.EASYDEBRID_SERVICE,
    constants.OFFCLOUD_SERVICE,
    constants.PREMIUMIZE_SERVICE,
    constants.PIKPAK_SERVICE,
    constants.REALDEBRID_SERVICE,
    constants.TORBOX_SERVICE,
    constants.TORRIN_SERVICE,
  ] as const;

  protected static readonly socialLinks: Option['socials'] = [
    {
      id: 'github',
      url: 'https://github.com/MunifTanjim/stremthru',
    },
    { id: 'buymeacoffee', url: 'https://buymeacoffee.com/muniftanjim' },
    { id: 'patreon', url: 'https://patreon.com/MunifTanjim' },
  ];

  protected static override getServiceCredential(
    serviceId: ServiceId,
    userData: UserData,
    specialCases?: Partial<Record<ServiceId, (credentials: any) => any>>
  ) {
    return super.getServiceCredential(serviceId, userData, {
      ...stremthruSpecialCases,
      ...specialCases,
    });
  }
}

export type StremThruServiceId =
  (typeof StremThruPreset.supportedServices)[number];
