import { Stream, ParsedStream, Addon, ParsedFile } from '../db';
import { constants, createLogger, FULL_LANGUAGE_MAPPING } from '../utils';
import FileParser from './file';
const logger = createLogger('parser');

class StreamParser {
  private count = 0;
  get errorRegexes(): { pattern: RegExp; message: string }[] | undefined {
    return [
      {
        pattern: /invalid\s+\w+\s+(account|apikey|token)/i,
        message: 'Invalid account or apikey or token',
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
    let parsedStream: ParsedStream = {
      id: this.getRandomId(),
      addon: this.addon,
      type: 'http',
      url: this.applyUrlModifications(stream.url ?? undefined),
      externalUrl: stream.externalUrl ?? undefined,
      ytId: stream.ytId ?? undefined,
      requestHeaders: stream.behaviorHints?.proxyHeaders?.request,
      responseHeaders: stream.behaviorHints?.proxyHeaders?.response,
      notWebReady: stream.behaviorHints?.notWebReady ?? undefined,
      videoHash: stream.behaviorHints?.videoHash ?? undefined,
      originalName: stream.name ?? undefined,
      originalDescription: (stream.description || stream.title) ?? undefined,
    };

    stream.description = stream.description || stream.title;

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
    parsedStream.indexer = this.getIndexer(stream, parsedStream);
    parsedStream.service = this.getService(stream, parsedStream);
    parsedStream.duration = this.getDuration(stream, parsedStream);
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
      infoHash:
        parsedStream.type === 'p2p'
          ? (stream.infoHash ?? undefined)
          : this.getInfoHash(stream, parsedStream),
      seeders: this.getSeeders(stream, parsedStream),
      sources: stream.sources ?? undefined,
      fileIdx: stream.fileIdx ?? undefined,
    };

    return parsedStream;
  }

  protected getRandomId(): string {
    return `${this.addon.instanceId}-${this.count++}`;
  }

  protected applyUrlModifications(url: string | undefined): string | undefined {
    return url;
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
      if (parsed.year || (parsed.season && parsed.episode) || parsed.episode) {
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
      ?.replace(/^[^:]+:\s*/g, '');
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
    return undefined;
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
      size = parseInt(size);
    } else if (typeof size === 'number') {
      size = Math.round(size);
    }

    return size;
  }

  protected getFolderSize(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): number | undefined {
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
  ): string | undefined {
    const regex = this.ageRegex;
    if (!regex) {
      return undefined;
    }
    const match = stream.description?.match(regex);
    if (match) {
      return match[1];
    }

    return undefined;
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
      return match[1];
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

  protected getDuration(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): number | undefined {
    // Regular expression to match different formats of time durations
    const regex =
      /(?<![^\s\[(_\-,.])(?:(\d+)h[:\s]?(\d+)m[:\s]?(\d+)s|(\d+)h[:\s]?(\d+)m|(\d+)h|(\d+)m|(\d+)s)(?=[\s\)\]_.\-,]|$)/gi;

    const match = regex.exec(stream.description || stream.title || '');
    if (!match) {
      return 0;
    }

    const hours = parseInt(match[1] || match[4] || match[6] || '0', 10);
    const minutes = parseInt(match[2] || match[5] || match[7] || '0', 10);
    const seconds = parseInt(match[3] || match[8] || '0', 10);

    // Convert to milliseconds
    const totalMilliseconds = (hours * 3600 + minutes * 60 + seconds) * 1000;

    return totalMilliseconds;
  }

  protected getStreamType(
    stream: Stream,
    service: ParsedStream['service'],
    currentParsedStream: ParsedStream
  ): ParsedStream['type'] {
    if (stream.infoHash) {
      return 'p2p';
    }

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

    if (stream.externalUrl) {
      return 'external';
    }

    if (stream.ytId) {
      return 'youtube';
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

    return {
      title: folderParsed?.title || fileParsed?.title,
      year: fileParsed?.year || folderParsed?.year,
      season: fileParsed?.season || folderParsed?.season,
      episode: fileParsed?.episode || folderParsed?.episode,
      seasons: fileParsed?.seasons || folderParsed?.seasons,
      resolution: fileParsed?.resolution || folderParsed?.resolution,
      quality: fileParsed?.quality || folderParsed?.quality,
      encode: fileParsed?.encode || folderParsed?.encode,
      releaseGroup: fileParsed?.releaseGroup || folderParsed?.releaseGroup,
      seasonEpisode: fileParsed?.seasonEpisode || folderParsed?.seasonEpisode,
      visualTags: Array.from(
        new Set([
          ...(folderParsed?.visualTags ?? []),
          ...(fileParsed?.visualTags ?? []),
        ])
      ),
      audioTags: Array.from(
        new Set([
          ...(folderParsed?.audioTags ?? []),
          ...(fileParsed?.audioTags ?? []),
        ])
      ),
      audioChannels: Array.from(
        new Set([
          ...(folderParsed?.audioChannels ?? []),
          ...(fileParsed?.audioChannels ?? []),
        ])
      ),
      languages: Array.from(
        new Set([
          ...(folderParsed?.languages ?? []),
          ...(fileParsed?.languages ?? []),
          ...this.getLanguages(stream, parsedStream),
        ])
      ),
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
