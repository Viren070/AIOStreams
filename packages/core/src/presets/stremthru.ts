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
};

export class StremThruStreamParser extends StreamParser {
  protected override getIndexer(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): string | undefined {
    return undefined;
  }

  protected override getFolderSize(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): number | undefined {
    let folderSize = this.calculateBytesFromSizeString(
      stream.description ?? '',
      /📦\s*(\d+(\.\d+)?)\s?(KB|MB|GB|TB)/i
    );
    if (folderSize && currentParsedStream.size) {
      if (
        Math.abs(folderSize - currentParsedStream.size) <=
        currentParsedStream.size * 0.05
      ) {
        return undefined;
      }
    }
    return folderSize;
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
