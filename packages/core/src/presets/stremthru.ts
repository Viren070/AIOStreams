import { Option, ParsedStream, Stream, UserData } from '../db/index.js';
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
  [constants.QBITTORRENT_SERVICE]: (credentials: any) => {
    const base = `${credentials.url}|${credentials.username}|${credentials.password}|${credentials.fileBaseUrl}`;
    return credentials.pathMapping ? `${base}|${credentials.pathMapping}` : base;
  },
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
    constants.QBITTORRENT_SERVICE,
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
