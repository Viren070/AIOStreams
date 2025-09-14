import { ParsedStream, Stream, UserData } from '../db';
import { StreamParser } from '../parser';
import { ServiceId } from '../utils/constants';
import { Preset } from './preset';
import { stremthruSpecialCases } from './stremthru';

export class BuiltinStreamParser extends StreamParser {
  override getFolder(stream: Stream): string | undefined {
    if (!stream.description) {
      return undefined;
    }
    const folderName = stream.description.split('\n')[0];
    return folderName.trim() || undefined;
  }

  protected getError(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): ParsedStream['error'] | undefined {
    if (stream.name?.startsWith('[❌]')) {
      return {
        // title: stream.name.replace('[❌]', ''),
        title: this.addon.name,
        description: stream.description || 'Unknown error',
      };
    }
    return undefined;
  }
  protected parseServiceData(
    string: string
  ): ParsedStream['service'] | undefined {
    return super.parseServiceData(string.replace('TorBox', ''));
  }

  protected getInLibrary(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): boolean {
    return stream.name?.includes('☁️') ?? false;
  }

  protected get ageRegex(): RegExp | undefined {
    return this.getRegexForTextAfterEmojis(['🕒']);
  }

  protected getStreamType(
    stream: Stream,
    service: ParsedStream['service'],
    currentParsedStream: ParsedStream
  ): ParsedStream['type'] {
    return (stream as any).type === 'usenet' ? 'usenet' : 'debrid';
  }
}

export class BuiltinAddonPreset extends Preset {
  static override getParser(): typeof StreamParser {
    return BuiltinStreamParser;
  }

  protected static getServiceCredential(
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
