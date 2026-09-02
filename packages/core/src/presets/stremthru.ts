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

  // 🎙️/💬 are handled in getParsedFileMergeOverrides. 🌐 is ambiguous (probe
  // vs. filename guess), so fall back to the generic scan for it.
  protected override getLanguages(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): string[] {
    if (!stream.description?.includes('🌐')) return [];
    return super.getLanguages(stream, currentParsedStream);
  }

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
