import { Parser } from 'expr-eval';
import {
  ParsedStream,
  ParsedStreams,
  ParsedStreamSchema,
} from '../db/schemas.js';
import bytes from 'bytes';

export abstract class StreamExpressionEngine {
  protected parser: Parser;

  constructor() {
    // only allow comparison and logical operators
    this.parser = new Parser({
      operators: {
        comparison: true,
        logical: true,
        add: true,
        concatenate: false,
        conditional: true,
        divide: false,
        factorial: false,
        multiply: false,
        power: false,
        remainder: false,
        subtract: true,
        sin: false,
        cos: false,
        tan: false,
        asin: false,
        acos: false,
        atan: false,
        sinh: false,
        cosh: false,
        tanh: false,
        asinh: false,
        acosh: false,
        atanh: false,
        sqrt: false,
        log: false,
        ln: false,
        lg: false,
        log10: false,
        abs: false,
        ceil: false,
        floor: false,
        round: false,
        trunc: false,
        exp: false,
        length: false,
        in: false,
        random: false,
        min: true,
        max: true,
        assignment: false,
        fndef: false,
        cbrt: false,
        expm1: false,
        log1p: false,
        sign: false,
        log2: false,
      },
    });

    this.setupParserFunctions();
  }

  private setupParserFunctions() {
    this.parser.functions.regexMatched = function (
      streams: ParsedStream[],
      ...regexNames: string[]
    ) {
      if (regexNames.length === 0) {
        return streams.filter((stream) => stream.regexMatched);
      }
      return streams.filter((stream) =>
        regexNames.some((regexName) => stream.regexMatched?.name === regexName)
      );
    };

    // gets all streams that have a regex matched with an index in the range of min and max
    this.parser.functions.regexMatchedInRange = function (
      streams: ParsedStream[],
      min: number,
      max: number
    ) {
      return streams.filter((stream) => {
        if (!stream.regexMatched) {
          return false;
        } else if (
          stream.regexMatched.index < min ||
          stream.regexMatched.index > max
        ) {
          return false;
        }
        return true;
      });
    };

    this.parser.functions.indexer = function (
      streams: ParsedStream[],
      ...indexers: string[]
    ) {
      if (!Array.isArray(streams) || streams.some((stream) => !stream.type)) {
        throw new Error('Your streams input must be an array of streams');
      } else if (
        indexers.length === 0 ||
        indexers.some((i) => typeof i !== 'string')
      ) {
        throw new Error('You must provide one or more indexer strings');
      }
      return streams.filter((stream) =>
        indexers.includes(stream.indexer || 'Unknown')
      );
    };

    this.parser.functions.resolution = function (
      streams: ParsedStream[],
      ...resolutions: string[]
    ) {
      if (!Array.isArray(streams) || streams.some((stream) => !stream.type)) {
        throw new Error('Your streams input must be an array of streams');
      } else if (
        resolutions.length === 0 ||
        resolutions.some((r) => typeof r !== 'string')
      ) {
        throw new Error('You must provide one or more resolution strings');
      }

      return streams.filter((stream) =>
        resolutions
          .map((r) => r.toLowerCase())
          .includes(stream.parsedFile?.resolution?.toLowerCase() || 'unknown')
      );
    };

    this.parser.functions.quality = function (
      streams: ParsedStream[],
      ...qualities: string[]
    ) {
      if (!Array.isArray(streams) || streams.some((stream) => !stream.type)) {
        throw new Error('Your streams input must be an array of streams');
      } else if (
        qualities.length === 0 ||
        qualities.some((q) => typeof q !== 'string')
      ) {
        throw new Error('You must provide one or more quality strings');
      }
      return streams.filter((stream) =>
        qualities
          .map((q) => q.toLowerCase())
          .includes(stream.parsedFile?.quality?.toLowerCase() || 'unknown')
      );
    };

    this.parser.functions.encode = function (
      streams: ParsedStream[],
      ...encodes: string[]
    ) {
      if (!Array.isArray(streams) || streams.some((stream) => !stream.type)) {
        throw new Error('Your streams input must be an array of streams');
      } else if (
        encodes.length === 0 ||
        encodes.some((e) => typeof e !== 'string')
      ) {
        throw new Error('You must provide one or more encode strings');
      }
      return streams.filter((stream) =>
        encodes
          .map((encode) => encode.toLowerCase())
          .includes(stream.parsedFile?.encode?.toLowerCase() || 'unknown')
      );
    };

    this.parser.functions.type = function (
      streams: ParsedStream[],
      ...types: string[]
    ) {
      if (!Array.isArray(streams)) {
        throw new Error('Your streams input must be an array of streams');
      } else if (
        types.length === 0 ||
        types.some((t) => typeof t !== 'string')
      ) {
        throw new Error('You must provide one or more type string parameters');
      }
      return streams.filter((stream) =>
        types.map((t) => t.toLowerCase()).includes(stream.type.toLowerCase())
      );
    };

    this.parser.functions.visualTag = function (
      streams: ParsedStream[],
      ...visualTags: string[]
    ) {
      if (!Array.isArray(streams) || streams.some((stream) => !stream.type)) {
        throw new Error('Your streams input must be an array of streams');
      } else if (
        visualTags.length === 0 ||
        visualTags.some((v) => typeof v !== 'string')
      ) {
        throw new Error(
          'You must provide one or more visual tag string parameters'
        );
      }
      return streams.filter((stream) =>
        (stream.parsedFile?.visualTags.length
          ? stream.parsedFile.visualTags
          : ['Unknown']
        ).some((v) =>
          visualTags.map((vt) => vt.toLowerCase()).includes(v.toLowerCase())
        )
      );
    };

    this.parser.functions.audioTag = function (
      streams: ParsedStream[],
      ...audioTags: string[]
    ) {
      if (!Array.isArray(streams) || streams.some((stream) => !stream.type)) {
        throw new Error('Your streams input must be an array of streams');
      } else if (
        audioTags.length === 0 ||
        audioTags.some((a) => typeof a !== 'string')
      ) {
        throw new Error(
          'You must provide one or more audio tag string parameters'
        );
      }
      return streams.filter((stream) =>
        audioTags
          .map((a) => a.toLowerCase())
          .some((a) =>
            (stream.parsedFile?.audioTags.length
              ? stream.parsedFile.audioTags
              : ['Unknown']
            )
              .map((at) => at.toLowerCase())
              .includes(a)
          )
      );
    };

    this.parser.functions.audioChannels = function (
      streams: ParsedStream[],
      ...audioChannels: string[]
    ) {
      if (!Array.isArray(streams) || streams.some((stream) => !stream.type)) {
        throw new Error('Your streams input must be an array of streams');
      } else if (
        audioChannels.length === 0 ||
        audioChannels.some((a) => typeof a !== 'string')
      ) {
        throw new Error(
          'You must provide one or more audio channel string parameters'
        );
      }
      return streams.filter((stream) =>
        audioChannels
          .map((a) => a.toLowerCase())
          .some((a) =>
            (stream.parsedFile?.audioChannels.length
              ? stream.parsedFile.audioChannels
              : ['Unknown']
            )
              ?.map((ac) => ac.toLowerCase())
              .includes(a)
          )
      );
    };

    this.parser.functions.language = function (
      streams: ParsedStream[],
      ...languages: string[]
    ) {
      if (!Array.isArray(streams) || streams.some((stream) => !stream.type)) {
        throw new Error('Your streams input must be an array of streams');
      } else if (
        languages.length === 0 ||
        languages.some((l) => typeof l !== 'string')
      ) {
        throw new Error(
          'You must provide one or more language string parameters'
        );
      }
      return streams.filter((stream) =>
        languages
          .map((l) => l.toLowerCase())
          .some((l) =>
            (stream.parsedFile?.languages.length
              ? stream.parsedFile.languages
              : ['Unknown']
            )
              ?.map((lang) => lang.toLowerCase())
              .includes(l)
          )
      );
    };

    this.parser.functions.seeders = function (
      streams: ParsedStream[],
      minSeeders?: number,
      maxSeeders?: number
    ) {
      if (!Array.isArray(streams) || streams.some((stream) => !stream.type)) {
        throw new Error('Your streams input must be an array of streams');
      } else if (
        typeof minSeeders !== 'number' &&
        typeof maxSeeders !== 'number'
      ) {
        throw new Error('Min and max seeders must be a number');
      }
      // select streams with seeders that lie within the range.
      return streams.filter((stream) => {
        if (minSeeders && (stream.torrent?.seeders ?? 0) < minSeeders) {
          return false;
        }
        if (maxSeeders && (stream.torrent?.seeders ?? 0) > maxSeeders) {
          return false;
        }
        return true;
      });
    };

    this.parser.functions.size = function (
      streams: ParsedStream[],
      minSize?: string | number,
      maxSize?: string | number
    ) {
      if (!Array.isArray(streams) || streams.some((stream) => !stream.type)) {
        throw new Error('Your streams input must be an array of streams');
      } else if (
        typeof minSize !== 'number' &&
        typeof maxSize !== 'number' &&
        typeof minSize !== 'string' &&
        typeof maxSize !== 'string'
      ) {
        throw new Error('Min and max size must be a number');
      }
      // use the bytes library to ensure we get a number
      const minSizeInBytes =
        typeof minSize === 'string' ? bytes.parse(minSize) : minSize;
      const maxSizeInBytes =
        typeof maxSize === 'string' ? bytes.parse(maxSize) : maxSize;
      return streams.filter((stream) => {
        if (minSize && minSizeInBytes && (stream.size ?? 0) < minSizeInBytes) {
          return false;
        }
        if (maxSize && maxSizeInBytes && (stream.size ?? 0) > maxSizeInBytes) {
          return false;
        }
        return true;
      });
    };

    this.parser.functions.service = function (
      streams: ParsedStream[],
      ...services: string[]
    ) {
      if (!Array.isArray(streams) || streams.some((stream) => !stream.type)) {
        throw new Error('Your streams input must be an array of streams');
      } else if (
        services.length === 0 ||
        services.some((s) => typeof s !== 'string')
      ) {
        throw new Error(
          'You must provide one or more service string parameters'
        );
      } else if (
        services.length === 0 ||
        services.some((s) => typeof s !== 'string')
      ) {
        throw new Error(
          'You must provide one or more service string parameters'
        );
      } else if (
        !services.every((s) =>
          [
            'realdebrid',
            'debridlink',
            'alldebrid',
            'torbox',
            'pikpak',
            'seedr',
            'offcloud',
            'premiumize',
            'easynews',
            'easydebrid',
            'debrider',
          ].includes(s)
        )
      ) {
        throw new Error(
          'Service must be a string and one of: realdebrid, debridlink, alldebrid, torbox, pikpak, seedr, offcloud, premiumize, easynews, easydebrid, debrider'
        );
      }
      return streams.filter((stream) =>
        services.some((s) => stream.service?.id === s)
      );
    };

    this.parser.functions.cached = function (streams: ParsedStream[]) {
      if (!Array.isArray(streams)) {
        throw new Error(
          "Please use one of 'totalStreams' or 'previousStreams' as the first argument"
        );
      }
      return streams.filter((stream) => stream.service?.cached === true);
    };

    this.parser.functions.uncached = function (streams: ParsedStream[]) {
      if (!Array.isArray(streams)) {
        throw new Error(
          "Please use one of 'totalStreams' or 'previousStreams' as the first argument"
        );
      }
      return streams.filter((stream) => stream.service?.cached === false);
    };

    this.parser.functions.releaseGroup = function (
      streams: ParsedStream[],
      ...releaseGroups: string[]
    ) {
      if (!Array.isArray(streams)) {
        throw new Error(
          "Please use one of 'totalStreams' or 'previousStreams' as the first argument"
        );
      } else if (
        releaseGroups.length === 0 ||
        releaseGroups.some((r) => typeof r !== 'string')
      ) {
        throw new Error(
          'You must provide one or more release group string parameters'
        );
      }
      return streams.filter((stream) =>
        releaseGroups.some((r) => stream.parsedFile?.releaseGroup === r)
      );
    };

    this.parser.functions.addon = function (
      streams: ParsedStream[],
      ...addons: string[]
    ) {
      if (!Array.isArray(streams) || streams.some((stream) => !stream.type)) {
        throw new Error('Your streams input must be an array of streams');
      } else if (
        addons.length === 0 ||
        addons.some((a) => typeof a !== 'string')
      ) {
        throw new Error('You must provide one or more addon string parameters');
      }
      return streams.filter((stream) => addons.includes(stream.addon.name));
    };

    this.parser.functions.library = function (streams: ParsedStream[]) {
      if (!Array.isArray(streams) || streams.some((stream) => !stream.type)) {
        throw new Error('Your streams input must be an array of streams');
      }
      return streams.filter((stream) => stream.library);
    };

    this.parser.functions.count = function (streams: ParsedStream[]) {
      if (!Array.isArray(streams)) {
        throw new Error(
          "Please use one of 'totalStreams' or 'previousStreams' as the first argument"
        );
      }
      return streams.length;
    };

    this.parser.functions.negate = function (
      streams: ParsedStream[],
      originalStreams: ParsedStream[]
    ) {
      if (!Array.isArray(originalStreams) || !Array.isArray(streams)) {
        throw new Error(
          "Both arguments of the 'negate' function must be arrays of streams"
        );
      }
      const streamIds = new Set(streams.map((stream) => stream.id));
      return originalStreams.filter((stream) => !streamIds.has(stream.id));
    };

    this.parser.functions.merge = function (
      ...streamArrays: ParsedStream[][]
    ): ParsedStream[] {
      const seen = new Set<string>();
      const merged: ParsedStream[] = [];

      for (const array of streamArrays) {
        for (const stream of array) {
          if (!seen.has(stream.id)) {
            seen.add(stream.id);
            merged.push(stream);
          }
        }
      }

      return merged;
    };

    this.parser.functions.slice = function (
      streams: ParsedStream[],
      start: number,
      end?: number
    ) {
      if (!Array.isArray(streams)) {
        throw new Error('Your streams input must be an array of streams');
      }
      return streams.slice(start, end);
    };
  }

  protected async evaluateCondition(condition: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Condition parsing timed out'));
      }, 1);

      try {
        const result = this.parser.evaluate(condition);
        clearTimeout(timeout);
        resolve(result);
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
      }
    });
  }

  protected createTestStream(
    overrides: Partial<ParsedStream> = {}
  ): ParsedStream {
    const defaultStream: ParsedStream = {
      id: '1',
      type: 'http',
      addon: {
        preset: {
          type: 'test-preset',
          id: 'test-preset',
          options: {},
        },
        manifestUrl: 'https://example.com/manifest.json',
        enabled: true,
        name: 'Test Addon',
        timeout: 30000,
      },
      service: {
        id: 'realdebrid',
        cached: true,
      },
      indexer: 'Test Indexer',
      parsedFile: {
        title: 'Test Title',
        year: '2024',
        season: 1,
        episode: 1,
        seasons: [1],
        resolution: '1080p',
        quality: 'BluRay',
        encode: 'x264',
        releaseGroup: 'TEST',
        seasonEpisode: ['S01', 'E01'],
        visualTags: ['HDR'],
        audioTags: ['AAC'],
        audioChannels: ['2.0'],
        languages: ['English'],
      },
      size: 1073741824, // 1GB in bytes
      folderSize: 2147483648, // 2GB in bytes
      library: false,
      url: 'https://example.com/stream.mkv',
      filename: 'test.mkv',
      folderName: 'Test Folder',
      duration: 7200, // 2 hours in seconds
      age: '1 day',
      message: 'Test message',
      torrent: {
        infoHash: 'test-hash',
        fileIdx: 0,
        seeders: 100,
        sources: ['https://tracker.example.com'],
      },
      countryWhitelist: ['USA'],
      notWebReady: false,
      bingeGroup: 'test-group',
      requestHeaders: { 'User-Agent': 'Test' },
      responseHeaders: { 'Content-Type': 'video/mp4' },
      videoHash: 'test-video-hash',
      subtitles: [],
      proxied: false,
      regexMatched: {
        name: 'test-regex',
        pattern: 'test',
        index: 0,
      },
      keywordMatched: false,
      ytId: undefined,
      externalUrl: undefined,
      error: undefined,
      originalName: 'Original Test Name',
      originalDescription: 'Original Test Description',
    };

    return { ...defaultStream, ...overrides };
  }
}

export class GroupConditionEvaluator extends StreamExpressionEngine {
  private previousStreams: ParsedStream[];
  private totalStreams: ParsedStream[];
  private previousGroupTimeTaken: number;
  private totalTimeTaken: number;

  constructor(
    previousStreams: ParsedStream[],
    totalStreams: ParsedStream[],
    previousGroupTimeTaken: number,
    totalTimeTaken: number,
    queryType: string
  ) {
    super();

    this.previousStreams = previousStreams;
    this.totalStreams = totalStreams;
    this.previousGroupTimeTaken = previousGroupTimeTaken;
    this.totalTimeTaken = totalTimeTaken;

    // Set up constants for this specific parser
    this.parser.consts.previousStreams = this.previousStreams;
    this.parser.consts.totalStreams = this.totalStreams;
    this.parser.consts.queryType = queryType;
    this.parser.consts.previousGroupTimeTaken = this.previousGroupTimeTaken;
    this.parser.consts.totalTimeTaken = this.totalTimeTaken;
  }

  async evaluate(condition: string) {
    return await this.evaluateCondition(condition);
  }

  static async testEvaluate(condition: string) {
    const parser = new GroupConditionEvaluator([], [], 0, 0, 'movie');
    return await parser.evaluate(condition);
  }
}

export class StreamSelector extends StreamExpressionEngine {
  private queryType: string;
  constructor(queryType: string) {
    super();
    this.queryType = queryType;
    this.parser.consts.queryType = queryType;
  }

  async select(
    streams: ParsedStream[],
    condition: string
  ): Promise<ParsedStream[]> {
    // Set the streams constant for this filter operation
    this.parser.consts.streams = streams;
    let selectedStreams: ParsedStream[] = [];

    selectedStreams = await this.evaluateCondition(condition);

    // if the result is a boolean value, convert it to the appropriate type
    // true = all streams, false = no streams
    if (typeof selectedStreams === 'boolean') {
      selectedStreams = selectedStreams ? streams : [];
    }

    // attempt to parse the result
    try {
      selectedStreams = ParsedStreams.parse(selectedStreams);
    } catch (error) {
      throw new Error(
        `Filter condition failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    return selectedStreams;
  }

  static async testSelect(condition: string): Promise<ParsedStream[]> {
    const parser = new StreamSelector('movie');
    const streams = [
      parser.createTestStream({ type: 'debrid' }),
      parser.createTestStream({ type: 'debrid' }),
      parser.createTestStream({ type: 'debrid' }),
      parser.createTestStream({ type: 'usenet' }),
      parser.createTestStream({ type: 'p2p' }),
      parser.createTestStream({ type: 'p2p' }),
    ];
    return await parser.select(streams, condition);
  }
}
