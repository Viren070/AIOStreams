import { Option, ParsedFile, ParsedStream, Stream, UserData } from '../db/index.js';
import { StreamParser } from '../parser/index.js';
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
    return this.getRegexForTextAfterEmojis(['📄', '📁']);
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

  protected getParsedFileMergeOverrides(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): Partial<ParsedFile> {
    const overrides: Partial<ParsedFile> = {};

    // Matches one or more flag emojis (each is two regional indicator chars) after an indicator emoji
    const getFlagRegex = (indicator: string) =>
      new RegExp(`${indicator}\\s*((?:[\\u{1F1E6}-\\u{1F1FF}]{2}\\s*)+)`, 'u');
    const audioRegex = getFlagRegex('🎙️');
    const subtitleRegex = getFlagRegex('💬');

    const audioMatch = stream.description?.match(audioRegex);
    const subtitleMatch = stream.description?.match(subtitleRegex);

    if (audioMatch) {
      const audioLangs = audioMatch[1]
        .split(' ')
        .map((part) => this.convertFlagToLanguage(part.trim()))
        .filter((lang) => lang !== undefined) as string[];
      if (audioLangs.length > 0) {
        overrides.languages = audioLangs;
      }
    }

    if (subtitleMatch) {
      const subtitleLangs = subtitleMatch[1]
        .split(' ')
        .map((part) => this.convertFlagToLanguage(part.trim()))
        .filter((lang) => lang !== undefined) as string[];
      if (subtitleLangs.length > 0) {
        overrides.subtitles = subtitleLangs;
      }
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
