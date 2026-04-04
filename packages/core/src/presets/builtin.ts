import { ParsedStream, Stream, UserData } from '../db/index.js';
import { StreamParser } from '../parser/index.js';
import FileParser from '../parser/file.js';
import { arrayMerge, mergeParsedFiles } from '../parser/merge.js';
import { ServiceId } from '../utils/constants.js';
import {
  constants,
  ParsedMediaInfo,
  normaliseParsedMediaInfo,
  toUrlSafeBase64,
} from '../utils/index.js';
import { Preset } from './preset.js';
import { stremthruSpecialCases } from './stremthru.js';

export class BuiltinStreamParser extends StreamParser {
  protected override getLanguages(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): string[] {
    const languages = super.getLanguages(stream, currentParsedStream);
    const builtinLanguages = (stream as Record<string, unknown>).languages as
      | string[]
      | undefined;
    if (builtinLanguages) {
      for (const lang of builtinLanguages) {
        if (!languages.includes(lang)) {
          languages.push(lang);
        }
      }
    }
    return languages;
  }

  protected override getParsedFile(stream: Stream, parsedStream: ParsedStream) {
    const folderParsed = parsedStream.folderName
      ? FileParser.parse(parsedStream.folderName)
      : undefined;
    const fileParsed = parsedStream.filename
      ? FileParser.parse(parsedStream.filename)
      : undefined;
    const provided = stream.parsedMediaInfo as ParsedMediaInfo | undefined;
    if (provided) {
      if (typeof provided.duration === 'number')
        parsedStream.duration = provided.duration;
      if (typeof provided.bitrate === 'number')
        parsedStream.bitrate = provided.bitrate;
    }

    const providedParsedMediaInfo = normaliseParsedMediaInfo(provided);

    const merged = mergeParsedFiles(fileParsed, folderParsed, {
      ...providedParsedMediaInfo,
      resolution:
        providedParsedMediaInfo?.resolution ||
        this.getResolution(stream, parsedStream) ||
        fileParsed?.resolution ||
        folderParsed?.resolution,
      releaseGroup:
        this.getReleaseGroup(stream, parsedStream) ||
        fileParsed?.releaseGroup ||
        folderParsed?.releaseGroup,
      languages: providedParsedMediaInfo?.languages?.length
        ? [...providedParsedMediaInfo.languages]
        : arrayMerge(
            arrayMerge(folderParsed?.languages, fileParsed?.languages),
            this.getLanguages(stream, parsedStream)
          ),
      subtitles: providedParsedMediaInfo?.subtitles?.length
        ? [...providedParsedMediaInfo.subtitles]
        : arrayMerge(folderParsed?.subtitles, fileParsed?.subtitles),
      audioTags: arrayMerge(
        providedParsedMediaInfo?.audioTags,
        arrayMerge(folderParsed?.audioTags, fileParsed?.audioTags)
      ),
      audioChannels: arrayMerge(
        providedParsedMediaInfo?.audioChannels,
        arrayMerge(folderParsed?.audioChannels, fileParsed?.audioChannels)
      ),
      visualTags: arrayMerge(
        providedParsedMediaInfo?.visualTags,
        arrayMerge(folderParsed?.visualTags, fileParsed?.visualTags)
      ),
      encode:
        providedParsedMediaInfo?.encode ||
        fileParsed?.encode ||
        folderParsed?.encode,
      hasChapters: providedParsedMediaInfo?.hasChapters,
    });

    if (!merged) return undefined;

    if (
      !merged.seasonPack &&
      merged.episodes &&
      merged.episodes.length > 0 &&
      parsedStream.folderSize &&
      parsedStream.size &&
      parsedStream.folderSize > parsedStream.size * 2
    ) {
      merged.seasonPack = true;
    }
    if (!merged.seasonPack && merged.episodes && merged.episodes.length > 5) {
      merged.seasonPack = true;
    }

    return merged;
  }

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
    return stream.name?.includes('🗃️') ?? false;
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

  protected override isPrivate(
    stream: Stream,
    _currentParsedStream: ParsedStream
  ): boolean | undefined {
    return stream.name?.includes('🔑') ? true : false;
  }

  protected override isFreeleech(
    stream: Stream,
    _currentParsedStream: ParsedStream
  ): boolean | undefined {
    return stream.name?.includes('FREELEECH') ? true : false;
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

  protected getReleaseGroup(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): string | undefined {
    return stream.description?.match(
      this.getRegexForTextAfterEmojis(['🏷️'])
    )?.[1];
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
      [constants.STREMTHRU_NEWZ_SERVICE]: (credentials: any) =>
        toUrlSafeBase64(
          JSON.stringify({
            url: credentials.url,
            authToken: credentials.authToken,
            publicUrl: credentials.publicUrl,
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
      tmdbReadAccessToken: userData.tmdbAccessToken,
      tmdbApiKey: userData.tmdbApiKey,
      tvdbApiKey: userData.tvdbApiKey,
      services: services.map((service) => ({
        id: service,
        credential: this.getServiceCredential(service, userData),
      })),
      cacheAndPlay: userData.cacheAndPlay,
      autoRemoveDownloads: userData.autoRemoveDownloads,
      checkOwned: userData.checkOwned ?? true,
    };
  }
}
