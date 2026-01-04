import { ParsedStream, Stream, UserData } from '../db/index.js';
import { StreamParser } from '../parser/index.js';
import { ServiceId } from '../utils/constants.js';
import { constants, toUrlSafeBase64 } from '../utils/index.js';
import { Preset } from './preset.js';
import { stremthruSpecialCases } from './stremthru.js';

export class BuiltinStreamParser extends StreamParser {
  protected getFolder(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): string | undefined {
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

  protected getService(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): ParsedStream['service'] | undefined {
    const service = this.parseServiceData(
      stream.name?.replace('Easynews', '') || ''
    );
    if (
      service &&
      (service.id === constants.NZBDAV_SERVICE ||
        service.id === constants.ALTMOUNT_SERVICE)
    ) {
      currentParsedStream.proxied = !stream.behaviorHints?.proxyHeaders;
    }
    return service;
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

  protected getAge(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): number | undefined {
    if (typeof stream.age === 'number') {
      currentParsedStream.duration = undefined;
      return stream.age;
    }
  }

  protected getStreamType(
    stream: Stream,
    service: ParsedStream['service'],
    currentParsedStream: ParsedStream
  ): ParsedStream['type'] {
    return stream.type === 'torrent'
      ? 'debrid'
      : (stream.type as 'usenet' | 'stremio-usenet');
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
    const nzbDavSpecialCase: Partial<
      Record<ServiceId, (credentials: any) => any>
    > = {
      [constants.NZBDAV_SERVICE]: (credentials: any) =>
        toUrlSafeBase64(
          JSON.stringify({
            nzbdavUrl: credentials.url,
            publicNzbdavUrl: credentials.publicUrl,
            nzbdavApiKey: credentials.apiKey,
            webdavUser: credentials.username,
            webdavPassword: credentials.password,
            aiostreamsAuth: credentials.aiostreamsAuth,
          })
        ),
      [constants.STREMIO_NNTP_SERVICE]: (credentials: any) =>
        credentials.servers, // this will be a base64 encoded json string of the nntp server config { username, password, host, port, useSsl, connections }[]
      [constants.EASYNEWS_SERVICE]: (credentials: any) =>
        toUrlSafeBase64(
          JSON.stringify({
            username: credentials.username,
            password: credentials.password,
          })
        ),
    };
    const altmountSpecialCase: Partial<
      Record<ServiceId, (credentials: any) => any>
    > = {
      [constants.ALTMOUNT_SERVICE]: (credentials: any) =>
        toUrlSafeBase64(
          JSON.stringify({
            altmountUrl: credentials.url,
            publicAltmountUrl: credentials.publicUrl,
            altmountApiKey: credentials.apiKey,
            webdavUser: credentials.username,
            webdavPassword: credentials.password,
            aiostreamsAuth: credentials.aiostreamsAuth,
          })
        ),
    };
    return super.getServiceCredential(serviceId, userData, {
      ...stremthruSpecialCases,
      ...specialCases,
      ...nzbDavSpecialCase,
      ...altmountSpecialCase,
    });
  }

  protected static getBaseConfig(userData: UserData, services: ServiceId[]) {
    return {
      tmdbAccessToken: userData.tmdbAccessToken,
      tmdbApiKey: userData.tmdbApiKey,
      tvdbApiKey: userData.tvdbApiKey,
      services: services.map((service) => ({
        id: service,
        credential: this.getServiceCredential(service, userData),
      })),
      cacheAndPlay: userData.cacheAndPlay,
      cleanupAfterResolve: userData.cleanupAfterResolve,
    };
  }
}
