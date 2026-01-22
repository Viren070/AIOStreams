import bytes from 'bytes';
import { Stream, ParsedStream, Addon, ParsedFile } from '../db/index.js';
import {
  constants,
  createLogger,
  Env,
  FULL_LANGUAGE_MAPPING,
} from '../utils/index.js';
import FileParser from './file.js';
import { parseAgeString, parseDuration } from './utils.js';
const logger = createLogger('parser');

class StreamParser {
  private count = 0;
  get errorRegexes(): { pattern: RegExp; message: string }[] | undefined {
    return [
      {
        pattern: /invalid\s+\w+\s+(account|apikey|token)/i,
        message: 'Invalid account or apikey or token',
      },
      {
        pattern: /public\s+rate[-\s]?limit\s+exceeded/i,
        message: 'Public rate limit exceeded',
      },
    ];
  }
  protected get filenameRegex(): RegExp | undefined {
    return undefined;
  }
  protected get folderNameRegex(): RegExp | undefined {
    return undefined;
  }

  protected get sizeRegex(): RegExp | undefined {
    return /(\d+(\.\d+)?)\s?(KB|MB|GB|TB)/i;
  }
  protected get sizeK(): 1024 | 1000 {
    return 1024;
  }

  protected get seedersRegex(): RegExp | undefined {
    return /[👥👤]\s*(\d+)/u;
  }

  protected get indexerEmojis(): string[] {
    return ['🌐', '⚙️', '🔗', '🔎', '🔍', '☁️'];
  }

  protected get indexerRegex(): RegExp | undefined {
    return this.getRegexForTextAfterEmojis(this.indexerEmojis);
  }

  protected get ageRegex(): RegExp | undefined {
    return undefined;
  }

  protected getRegexForTextAfterEmojis(emojis: string[]): RegExp {
    return new RegExp(
      `(?:${emojis.join('|')})\\s*([^\\p{Emoji_Presentation}\\n]*?)(?=\\p{Emoji_Presentation}|$|\\n)`,
      'u'
    );
  }

  constructor(protected readonly addon: Addon) {}

  parse(stream: Stream): ParsedStream | { skip: true } {
    if (this.shouldSkip(stream)) {
      return { skip: true };
    }
    stream.description = stream.description || stream.title;

    let parsedStream: ParsedStream = {
      id: this.getRandomId(),
      addon: this.addon,
      type: 'http',
      proxied: this.isProxied(stream),
      url: this.applyUrlModifications(stream.url ?? undefined),
      nzbUrl: stream.nzbUrl ?? undefined,
      tarUrls: stream.tarUrls ?? undefined,
      tgzUrls: stream.tgzUrls ?? undefined,
      '7zipUrls': stream['7zipUrls'] ?? undefined,
      rarUrls: stream.rarUrls ?? undefined,
      servers: stream.servers ?? undefined,
      externalUrl: stream.externalUrl ?? undefined,
      ytId: stream.ytId ?? undefined,
      requestHeaders: stream.behaviorHints?.proxyHeaders?.request,
      responseHeaders: stream.behaviorHints?.proxyHeaders?.response,
      notWebReady: stream.behaviorHints?.notWebReady ?? undefined,
      videoHash: stream.behaviorHints?.videoHash ?? undefined,
      originalName: stream.name ?? undefined,
      originalDescription: (stream.description || stream.title) ?? undefined,
    };

    this.raiseErrorIfNecessary(stream, parsedStream);

    parsedStream.error = this.getError(stream, parsedStream);
    if (parsedStream.error) {
      parsedStream.type = constants.ERROR_STREAM_TYPE;
      return parsedStream;
    }

    const normaliseText = (text: string) => {
      return text
        .replace(
          /(mkv|mp4|avi|mov|wmv|flv|webm|m4v|mpg|mpeg|3gp|3g2|m2ts|ts|vob|ogv|ogm|divx|xvid|rm|rmvb|asf|mxf|mka|mks|mk3d|webm|f4v|f4p|f4a|f4b)$/i,
          ''
        )
        .replace(/[^\p{L}\p{N}+]/gu, '')

        .toLowerCase()
        .trim();
    };

    parsedStream.filename = this.getFilename(stream, parsedStream);
    parsedStream.folderName = this.getFolder(stream, parsedStream);
    if (
      parsedStream.folderName &&
      parsedStream.filename &&
      normaliseText(parsedStream.folderName) ===
        normaliseText(parsedStream.filename)
    ) {
      parsedStream.folderName = undefined;
    }
    parsedStream.size = this.getSize(stream, parsedStream);
    parsedStream.folderSize = this.getFolderSize(stream, parsedStream);
    if (
      parsedStream.size &&
      parsedStream.folderSize &&
      Math.abs(parsedStream.size - parsedStream.folderSize) /
        parsedStream.size <
        0.05
    ) {
      parsedStream.folderSize = undefined;
    }
    parsedStream.indexer = this.getIndexer(stream, parsedStream);
    parsedStream.service = this.getService(stream, parsedStream);
    parsedStream.duration = this.getDuration(stream, parsedStream);
    parsedStream.bitrate = this.getBitrate(stream, parsedStream);
    parsedStream.type = this.getStreamType(
      stream,
      parsedStream.service,
      parsedStream
    );
    parsedStream.library = this.getInLibrary(stream, parsedStream);
    parsedStream.age = this.getAge(stream, parsedStream);
    parsedStream.message = this.getMessage(stream, parsedStream);

    parsedStream.parsedFile = this.getParsedFile(stream, parsedStream);

    parsedStream.torrent = {
      infoHash: stream.infoHash ?? this.getInfoHash(stream, parsedStream),
      seeders: this.getSeeders(stream, parsedStream),
      sources: stream.sources ?? undefined,
      fileIdx:
        stream.fileIdx ?? this.getFileIdx(stream, parsedStream) ?? undefined,
      private: this.isPrivate(stream, parsedStream),
    };

    return parsedStream;
  }

  protected getRandomId(): string {
    return `${this.addon.instanceId}-${this.count++}`;
  }

  protected applyUrlModifications(url: string | undefined): string | undefined {
    if (url && Env.STREAM_URL_MAPPINGS) {
      let streamUrl;
      try {
        streamUrl = new URL(url);
      } catch (e) {
        return url;
      }
      for (const [key, value] of Object.entries(Env.STREAM_URL_MAPPINGS)) {
        if (streamUrl.origin === key) {
          const mappedUrl = new URL(value);
          streamUrl.protocol = mappedUrl.protocol;
          streamUrl.host = mappedUrl.host;
          streamUrl.port = mappedUrl.port;
        }
      }
      return streamUrl.toString();
    }
    return url;
  }

  protected shouldSkip(stream: Stream): boolean {
    return false;
  }

  protected raiseErrorIfNecessary(
    stream: Stream,
    currentParsedStream: ParsedStream
  ) {
    if (!this.errorRegexes) {
      return;
    }
    for (const errorRegex of this.errorRegexes) {
      if (errorRegex.pattern.test(stream.description || stream.title || '')) {
        throw new Error(errorRegex.message);
      }
    }
  }

  protected getError(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): ParsedStream['error'] | undefined {
    return undefined;
  }

  protected getFilename(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): string | undefined {
    let filename = stream.behaviorHints?.filename;

    if (filename) {
      return filename;
    }

    const description = stream.description || stream.title;
    if (!description) {
      return undefined;
    }

    if (this.filenameRegex) {
      const match = description.match(this.filenameRegex);
      if (match) {
        return match[1];
      }
    }

    // attempt to find a filename by finding the most suitable line that has more info
    const potentialFilenames = description
      .split('\n')
      .filter((line) => line.trim() !== '')
      .splice(0, 5);

    for (const line of potentialFilenames) {
      const parsed = FileParser.parse(line);
      if (parsed.year || parsed.seasons?.length || parsed.episodes?.length) {
        filename = line;
        break;
      }
    }

    if (!filename) {
      filename = description.split('\n')[0];
    }
    return filename
      ?.trim()
      ?.replace(/^\p{Emoji_Presentation}+/gu, '')
      ?.replace(/^[^\s:]+:\s*/, '');
  }

  protected getFolder(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): string | undefined {
    if (this.folderNameRegex) {
      const match = stream.description?.match(this.folderNameRegex);
      if (match) {
        return match[1];
      }
    }
    if (typeof stream.behaviorHints?.folderName === 'string') {
      return stream.behaviorHints.folderName;
    }
    return undefined;
  }

  protected getResolution(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): string | undefined {
    return undefined; //
  }

  protected getReleaseGroup(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): string | undefined {
    return undefined; //
  }

  protected getSize(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): number | undefined {
    let description = stream.description || stream.title;
    if (currentParsedStream.filename && description) {
      description = description.replace(currentParsedStream.filename, '');
    }
    if (currentParsedStream.folderName && description) {
      description = description.replace(currentParsedStream.folderName, '');
    }
    let size =
      stream.behaviorHints?.videoSize ||
      (stream as any).size ||
      (stream as any).sizeBytes ||
      (stream as any).sizebytes ||
      (description && this.calculateBytesFromSizeString(description)) ||
      (stream.name && this.calculateBytesFromSizeString(stream.name));

    if (typeof size === 'string') {
      size = bytes.parse(size);
    } else if (typeof size === 'number') {
      size = Math.round(size);
    }

    return size;
  }

  protected getFolderSize(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): number | undefined {
    if (
      (stream.behaviorHints?.folderSize !== undefined &&
        typeof stream.behaviorHints?.folderSize === 'number') ||
      typeof stream.behaviorHints?.folderSize === 'string'
    ) {
      return (
        bytes.parse(stream.behaviorHints?.folderSize.toString()) ?? undefined
      );
    }
    return undefined;
  }

  protected getSeeders(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): number | undefined {
    const regex = this.seedersRegex;
    if (!regex) {
      return undefined;
    }
    const match = stream.description?.match(regex);
    if (match) {
      return parseInt(match[1]);
    }

    return undefined;
  }

  protected getAge(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): number | undefined {
    const regex = this.ageRegex;
    if (!regex) {
      return undefined;
    }
    const match = stream.description?.match(regex);
    if (match) {
      return parseAgeString(match[1]);
    }

    return undefined;
  }

  /**
   * Converts age strings like "1d", "5h", "30m", "456d" to hours
   * @param ageString - The age string to parse (e.g. "1d", "5h", "30m")
   * @returns The age in hours, or undefined if parsing fails
   */

  protected isProxied(stream: Stream): boolean {
    return false;
  }

  protected isPrivate(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): boolean | undefined {
    return false;
  }

  protected getIndexer(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): string | undefined {
    const regex = this.indexerRegex;
    if (!regex) {
      return undefined;
    }
    const match = stream.description?.match(regex);
    if (match) {
      return match[1].trim();
    }

    return undefined;
  }

  protected getMessage(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): string | undefined {
    return undefined;
  }

  protected getService(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): ParsedStream['service'] | undefined {
    return this.parseServiceData(stream.name || '');
  }

  protected getInfoHash(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): string | undefined {
    return stream.url
      ? stream.url.match(/(?<=[-/[(;:&])[a-fA-F0-9]{40}(?=[-\]\)/:;&])/)?.[0]
      : undefined;
  }

  protected getFileIdx(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): number | undefined {
    return undefined;
  }

  protected getDuration(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): number | undefined {
    return parseDuration(stream.description || '');
  }

  protected getBitrate(
    _: Stream,
    currentParsedStream: ParsedStream
  ): number | undefined {
    if (currentParsedStream.size && currentParsedStream.duration) {
      const sizeBits = currentParsedStream.size * 8;
      const durationSeconds = currentParsedStream.duration / 1000;
      if (durationSeconds > 0) {
        return Math.round(sizeBits / durationSeconds);
      }
    }
    return undefined;
  }

  protected getStreamType(
    stream: Stream,
    service: ParsedStream['service'],
    currentParsedStream: ParsedStream
  ): ParsedStream['type'] {
    if (stream.url?.endsWith('.m3u8')) {
      return 'live';
    }

    if (service?.id === constants.EASYNEWS_SERVICE) {
      return 'usenet';
    } else if (service) {
      return 'debrid';
    }

    // return 'http';
    if (stream.url) {
      return 'http';
    }

    if (stream.infoHash) {
      return 'p2p';
    }

    if (stream.externalUrl) {
      return 'external';
    }

    if (stream.ytId) {
      return 'youtube';
    }

    if (stream.nzbUrl) {
      return 'stremio-usenet';
    }
    if (
      stream['7zipUrls']?.length ||
      stream.rarUrls?.length ||
      stream?.tarUrls?.length ||
      stream.tgzUrls?.length
    ) {
      return 'archive';
    }
    throw new Error('Invalid stream, missing a required stream property');
  }

  protected getParsedFile(
    stream: Stream,
    parsedStream: ParsedStream
  ): ParsedFile | undefined {
    const folderParsed = parsedStream.folderName
      ? FileParser.parse(parsedStream.folderName)
      : undefined;
    const fileParsed = parsedStream.filename
      ? FileParser.parse(parsedStream.filename)
      : undefined;
    function arrayFallback<T>(...arrs: (T[] | undefined)[]): T[] | undefined {
      for (const arr of arrs) {
        if (arr && arr.length > 0) {
          return arr;
        }
      }
    }
    function arrayMerge<T>(arr1: T[] | undefined, arr2: T[] | undefined): T[] {
      return Array.from(new Set([...(arr1 ?? []), ...(arr2 ?? [])]));
    }

    let seasonPack = folderParsed?.seasonPack || fileParsed?.seasonPack;
    let episodes = arrayFallback(fileParsed?.episodes, folderParsed?.episodes);
    let seasons = arrayFallback(
      fileParsed?.seasons,
      folderParsed?.seasons,
      fileParsed?.volumes,
      folderParsed?.volumes
    );

    // Detect season pack based on folder size being significantly larger than file size
    if (
      seasonPack === undefined &&
      episodes &&
      episodes.length > 0 && // to handle movie folders
      parsedStream.folderSize &&
      parsedStream.size &&
      parsedStream.folderSize > parsedStream.size * 2
    ) {
      seasonPack = true;
    }
    // Detect season pack when more than 5 episodes are present
    if (seasonPack === undefined && episodes && episodes.length > 5) {
      seasonPack = true;
    }
    return {
      title: folderParsed?.title || fileParsed?.title,
      year: fileParsed?.year || folderParsed?.year,
      folderSeasons:
        seasons !== folderParsed?.seasons ? folderParsed?.seasons : undefined,
      folderEpisodes:
        episodes !== folderParsed?.episodes
          ? folderParsed?.episodes
          : undefined,
      seasons,
      episodes,
      resolution:
        this.getResolution(stream, parsedStream) ||
        fileParsed?.resolution ||
        folderParsed?.resolution,
      quality: fileParsed?.quality || folderParsed?.quality,
      encode: fileParsed?.encode || folderParsed?.encode,
      releaseGroup:
        this.getReleaseGroup(stream, parsedStream) ||
        fileParsed?.releaseGroup ||
        folderParsed?.releaseGroup,
      edition: fileParsed?.edition || folderParsed?.edition,
      remastered: fileParsed?.remastered || folderParsed?.remastered,
      repack: fileParsed?.repack || folderParsed?.repack,
      uncensored: fileParsed?.uncensored || folderParsed?.uncensored,
      unrated: fileParsed?.unrated || folderParsed?.unrated,
      upscaled: fileParsed?.upscaled || folderParsed?.upscaled,
      network: fileParsed?.network || folderParsed?.network,
      container: fileParsed?.container || folderParsed?.container,
      extension: fileParsed?.extension || folderParsed?.extension,
      visualTags: arrayMerge(folderParsed?.visualTags, fileParsed?.visualTags),
      audioTags: arrayMerge(folderParsed?.audioTags, fileParsed?.audioTags),
      audioChannels: arrayMerge(
        folderParsed?.audioChannels,
        fileParsed?.audioChannels
      ),
      languages: arrayMerge(
        arrayMerge(folderParsed?.languages, fileParsed?.languages),
        this.getLanguages(stream, parsedStream)
      ),
      seasonPack: folderParsed?.seasonPack || fileParsed?.seasonPack,
    };
  }

  /**
   * Extracts languages from the stream description using country flags.
   * @param stream - The stream object containing the description.
   * @param currentParsedStream - The current parsed stream object.
   * @returns An array of language strings.
   */
  protected getLanguages(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): string[] {
    const countryFlagPattern = /[\u{1F1E6}-\u{1F1FF}]{2}/gu;
    const descriptionMatches = stream.description?.match(countryFlagPattern);
    const nameMatches = stream.name?.match(countryFlagPattern);
    const flags = [
      ...(descriptionMatches ? [...new Set(descriptionMatches)] : []),
      ...(nameMatches ? [...new Set(nameMatches)] : []),
    ];
    const languages = flags
      .map((flag) => {
        const possibleLanguages = FULL_LANGUAGE_MAPPING.filter(
          (language) => language.flag === flag
        );

        const language =
          possibleLanguages.find((l) => l.flag_priority) ||
          possibleLanguages[0];
        const languageName = (
          language?.internal_english_name || language?.english_name
        )
          ?.split('(')?.[0]
          ?.trim();

        if (languageName && constants.LANGUAGES.includes(languageName as any)) {
          return languageName;
        }
        return undefined;
      })
      .filter((language) => language !== undefined);
    return languages;
  }

  protected convertISO6392ToLanguage(code: string): string | undefined {
    const lang = FULL_LANGUAGE_MAPPING.find(
      (language) => language.iso_639_2 === code
    );
    return lang?.english_name?.split('(')?.[0]?.trim();
  }

  protected getInLibrary(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): boolean {
    return this.addon.library ?? false;
  }

  protected calculateBytesFromSizeString(
    size: string,
    sizeRegex?: RegExp
  ): number | undefined {
    const k = this.sizeK;
    const sizePattern = sizeRegex || this.sizeRegex;
    if (!sizePattern) {
      return undefined;
    }
    const match = size.match(sizePattern);
    if (!match) return 0;
    const value = parseFloat(match[1]);
    const unit = match[3];

    switch (unit.toUpperCase()) {
      case 'TB':
        return value * k * k * k * k;
      case 'GB':
        return value * k * k * k;
      case 'MB':
        return value * k * k;
      case 'KB':
        return value * k;
      default:
        return 0;
    }
  }

  protected parseServiceData(
    string: string
  ): ParsedStream['service'] | undefined {
    const cleanString = string.replace(/web-?dl/i, '');
    const services = constants.SERVICE_DETAILS;
    const cachedSymbols = ['+', '⚡', '🚀', 'cached'];
    const uncachedSymbols = ['⏳', 'download', 'UNCACHED'];
    let streamService: ParsedStream['service'] | undefined;
    Object.values(services).forEach((service) => {
      // for each service, generate a regexp which creates a regex with all known names separated by |
      const regex = new RegExp(
        `(^|(?<![^ |[(_\\/\\-.]))(${service.knownNames.join('|')})(?=[ ⬇️⏳⚡+/|\\)\\]_.-]|$|\n)`,
        'im'
      );
      // check if the string contains the regex
      if (regex.test(cleanString)) {
        let cached: boolean = false;
        // check if any of the uncachedSymbols are in the string
        if (uncachedSymbols.some((symbol) => string.includes(symbol))) {
          cached = false;
        }
        // check if any of the cachedSymbols are in the string
        else if (cachedSymbols.some((symbol) => string.includes(symbol))) {
          cached = true;
        }

        streamService = {
          id: service.id,
          cached: cached,
        };
      }
    });
    return streamService;
  }
}

export default StreamParser;
