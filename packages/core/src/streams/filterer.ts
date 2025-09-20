import { ParsedStream, UserData } from '../db/schemas.js';
import {
  createLogger,
  FeatureControl,
  getTimeTakenSincePoint,
  constants,
  AnimeDatabase,
  IdParser,
  compileRegex,
  formRegexFromKeywords,
  safeRegexTest,
} from '../utils/index.js';
import { StreamType } from '../utils/constants.js';
import { StreamSelector } from '../parser/streamExpression.js';
import StreamUtils from './utils.js';
import { MetadataService } from '../metadata/service.js';
import { Metadata } from '../metadata/utils.js';
import { titleMatch } from '../parser/utils.js';
import { partial_ratio } from 'fuzzball';
import { calculateAbsoluteEpisode } from '../builtins/utils/general.js';
import { formatBytes } from '../formatters/utils.js';

const logger = createLogger('filterer');

interface Reason {
  total: number;
  details: Record<string, number>;
}

export interface FilterStatistics {
  removed: {
    titleMatching: Reason;
    yearMatching: Reason;
    seasonEpisodeMatching: Reason;
    excludedStreamType: Reason;
    requiredStreamType: Reason;
    excludedResolution: Reason;
    requiredResolution: Reason;
    excludedQuality: Reason;
    requiredQuality: Reason;
    excludedEncode: Reason;
    requiredEncode: Reason;
    excludedVisualTag: Reason;
    requiredVisualTag: Reason;
    excludedAudioTag: Reason;
    requiredAudioTag: Reason;
    excludedAudioChannel: Reason;
    requiredAudioChannel: Reason;
    excludedLanguage: Reason;
    requiredLanguage: Reason;
    excludedCached: Reason;
    excludedUncached: Reason;
    excludedRegex: Reason;
    requiredRegex: Reason;
    excludedKeywords: Reason;
    requiredKeywords: Reason;
    excludedSeederRange: Reason;
    requiredSeederRange: Reason;
    excludedFilterCondition: Reason;
    requiredFilterCondition: Reason;
    size: Reason;
  };
  included: {
    passthrough: Reason;
    resolution: Reason;
    quality: Reason;
    encode: Reason;
    visualTag: Reason;
    audioTag: Reason;
    audioChannel: Reason;
    language: Reason;
    streamType: Reason;
    size: Reason;
    seeder: Reason;
    regex: Reason;
    keywords: Reason;
    streamExpression: Reason;
  };
}

class StreamFilterer {
  private userData: UserData;
  private filterStatistics: FilterStatistics;

  constructor(userData: UserData) {
    this.userData = userData;
    this.filterStatistics = {
      removed: {
        titleMatching: { total: 0, details: {} },
        yearMatching: { total: 0, details: {} },
        seasonEpisodeMatching: { total: 0, details: {} },
        excludedStreamType: { total: 0, details: {} },
        requiredStreamType: { total: 0, details: {} },
        excludedResolution: { total: 0, details: {} },
        requiredResolution: { total: 0, details: {} },
        excludedQuality: { total: 0, details: {} },
        requiredQuality: { total: 0, details: {} },
        excludedEncode: { total: 0, details: {} },
        requiredEncode: { total: 0, details: {} },
        excludedVisualTag: { total: 0, details: {} },
        requiredVisualTag: { total: 0, details: {} },
        excludedAudioTag: { total: 0, details: {} },
        requiredAudioTag: { total: 0, details: {} },
        excludedAudioChannel: { total: 0, details: {} },
        requiredAudioChannel: { total: 0, details: {} },
        excludedLanguage: { total: 0, details: {} },
        requiredLanguage: { total: 0, details: {} },
        excludedCached: { total: 0, details: {} },
        excludedUncached: { total: 0, details: {} },
        excludedRegex: { total: 0, details: {} },
        requiredRegex: { total: 0, details: {} },
        excludedKeywords: { total: 0, details: {} },
        requiredKeywords: { total: 0, details: {} },
        excludedSeederRange: { total: 0, details: {} },
        requiredSeederRange: { total: 0, details: {} },
        excludedFilterCondition: { total: 0, details: {} },
        requiredFilterCondition: { total: 0, details: {} },
        size: { total: 0, details: {} },
      },
      included: {
        passthrough: { total: 0, details: {} },
        resolution: { total: 0, details: {} },
        quality: { total: 0, details: {} },
        encode: { total: 0, details: {} },
        visualTag: { total: 0, details: {} },
        audioTag: { total: 0, details: {} },
        audioChannel: { total: 0, details: {} },
        language: { total: 0, details: {} },
        streamType: { total: 0, details: {} },
        size: { total: 0, details: {} },
        seeder: { total: 0, details: {} },
        regex: { total: 0, details: {} },
        keywords: { total: 0, details: {} },
        streamExpression: { total: 0, details: {} },
      },
    };
  }

  private incrementRemovalReason(
    reason: keyof FilterStatistics['removed'],
    detail?: string
  ) {
    this.filterStatistics.removed[reason].total++;
    if (detail) {
      this.filterStatistics.removed[reason].details[detail] =
        (this.filterStatistics.removed[reason].details[detail] || 0) + 1;
    }
  }

  private incrementIncludedReason(
    reason: keyof FilterStatistics['included'],
    detail?: string
  ) {
    this.filterStatistics.included[reason].total++;
    if (detail) {
      this.filterStatistics.included[reason].details[detail] =
        (this.filterStatistics.included[reason].details[detail] || 0) + 1;
    }
  }

  public getFilterStatistics() {
    return this.filterStatistics;
  }

  public getFormattedFilterDetails(): {
    filterDetails: string[];
    includedDetails: string[];
  } {
    const filterDetails: string[] = [];
    for (const [reason, stats] of Object.entries(
      this.filterStatistics.removed
    )) {
      if (stats.total > 0) {
        // Convert camelCase to Title Case with spaces
        const formattedReason = reason
          .replace(/([A-Z])/g, ' $1')
          .replace(/^./, (str) => str.toUpperCase());

        filterDetails.push(`\n  📌 ${formattedReason} (${stats.total})`);
        for (const [detail, count] of Object.entries(stats.details)) {
          filterDetails.push(`    • ${count}× ${detail}`);
        }
      }
    }

    const includedDetails: string[] = [];
    for (const [reason, stats] of Object.entries(
      this.filterStatistics.included
    )) {
      if (stats.total > 0) {
        const formattedReason = reason
          .replace(/([A-Z])/g, ' $1')
          .replace(/^./, (str) => str.toUpperCase());
        includedDetails.push(`\n  📌 ${formattedReason} (${stats.total})`);
        for (const [detail, count] of Object.entries(stats.details)) {
          includedDetails.push(`    • ${count}× ${detail}`);
        }
      }
    }

    return { filterDetails, includedDetails };
  }

  public async filter(
    streams: ParsedStream[],
    type: string,
    id: string
  ): Promise<ParsedStream[]> {
    const parsedId = IdParser.parse(id, type);
    let isAnime = id.startsWith('kitsu');

    if (AnimeDatabase.getInstance().isAnime(id)) {
      isAnime = true;
    }

    const start = Date.now();
    const isRegexAllowed = await FeatureControl.isRegexAllowed(this.userData, [
      ...(this.userData.excludedRegexPatterns ?? []),
      ...(this.userData.requiredRegexPatterns ?? []),
      ...(this.userData.includedRegexPatterns ?? []),
    ]);

    let requestedMetadata:
      | (Metadata & { absoluteEpisode?: number })
      | undefined;
    if (
      (this.userData.titleMatching?.enabled ||
        this.userData.yearMatching?.enabled ||
        this.userData.seasonEpisodeMatching?.enabled) &&
      constants.TYPES.includes(type as any)
    ) {
      try {
        if (!parsedId) {
          throw new Error(`Invalid ID: ${id}`);
        }
        const animeEntry = AnimeDatabase.getInstance().getEntryById(
          parsedId.type,
          parsedId.value
        );
        if (animeEntry && !parsedId.season) {
          parsedId.season =
            animeEntry.imdb?.fromImdbSeason?.toString() ??
            animeEntry.trakt?.season?.toString();
        }
        requestedMetadata = await new MetadataService({
          tmdbAccessToken: this.userData.tmdbAccessToken,
          tmdbApiKey: this.userData.tmdbApiKey,
          tvdbApiKey: this.userData.tvdbApiKey,
        }).getMetadata(parsedId, type as any);
        if (
          isAnime &&
          parsedId.season &&
          parsedId.episode &&
          requestedMetadata.seasons
        ) {
          const seasons = requestedMetadata.seasons.map(
            ({ season_number, episode_count }) => ({
              number: season_number.toString(),
              episodes: episode_count,
            })
          );
          logger.debug(
            `Calculating absolute episode with current season and episode: ${parsedId.season}, ${parsedId.episode} and seasons: ${JSON.stringify(seasons)}`
          );
          requestedMetadata.absoluteEpisode = Number(
            calculateAbsoluteEpisode(parsedId.season, parsedId.episode, seasons)
          );
        }
        logger.info(`Fetched metadata for ${id}`, requestedMetadata);
      } catch (error) {
        logger.warn(
          `Error fetching titles for ${id}, title/year matching will not be performed: ${error}`
        );
      }
    }

    const normaliseTitle = (title: string) => {
      return title
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\p{L}\p{N}+]/gu, '')
        .toLowerCase();
    };

    const performTitleMatch = (stream: ParsedStream) => {
      const titleMatchingOptions = {
        mode: 'exact',
        ...(this.userData.titleMatching ?? {}),
      };
      if (!titleMatchingOptions || !titleMatchingOptions.enabled) {
        return true;
      }
      if (
        !requestedMetadata ||
        !requestedMetadata.titles ||
        requestedMetadata.titles.length === 0
      ) {
        return true;
      }

      const streamTitle = stream.parsedFile?.title;
      if (
        titleMatchingOptions.requestTypes?.length &&
        (!titleMatchingOptions.requestTypes.includes(type) ||
          (isAnime && !titleMatchingOptions.requestTypes.includes('anime')))
      ) {
        return true;
      }

      if (
        titleMatchingOptions.addons?.length &&
        !titleMatchingOptions.addons.includes(stream.addon.preset.id)
      ) {
        return true;
      }

      if (!streamTitle) {
        // only filter out movies without a year as series results usually don't include a year
        return false;
      }

      if (titleMatchingOptions.mode === 'exact') {
        return titleMatch(
          normaliseTitle(streamTitle),
          requestedMetadata.titles.map(normaliseTitle),
          {
            threshold: 0.85,
          }
        );
      } else {
        return titleMatch(
          normaliseTitle(streamTitle),
          requestedMetadata.titles.map(normaliseTitle),
          {
            threshold: 0.85,
            scorer: partial_ratio,
          }
        );
      }
    };

    const performYearMatch = (stream: ParsedStream) => {
      const yearMatchingOptions = {
        tolerance: 1,
        ...this.userData.yearMatching,
      };

      if (!yearMatchingOptions || !yearMatchingOptions.enabled) {
        return true;
      }

      if (!requestedMetadata || !requestedMetadata.year) {
        return true;
      }

      if (
        yearMatchingOptions.requestTypes?.length &&
        (!yearMatchingOptions.requestTypes.includes(type) ||
          (isAnime && !yearMatchingOptions.requestTypes.includes('anime')))
      ) {
        return true;
      }

      if (
        yearMatchingOptions.addons?.length &&
        !yearMatchingOptions.addons.includes(stream.addon.preset.id)
      ) {
        return true;
      }

      const streamYear = stream.parsedFile?.year;
      if (!streamYear) {
        // if no year is present, filter out if its a movie, keep otherwise
        return type === 'movie' ? false : true;
      }

      // streamYear can be a string like "2004" or "2012-2020"
      // Calculate the requested year range
      let requestedYearRange: [number, number] = [
        requestedMetadata.year,
        requestedMetadata.year,
      ];
      if (requestedMetadata.yearEnd) {
        requestedYearRange[1] = requestedMetadata.yearEnd;
      }

      // Calculate the stream year range
      let streamYearRange: [number, number];
      if (streamYear.includes('-')) {
        const [min, max] = streamYear.split('-').map(Number);
        streamYearRange = [min, max];
      } else {
        const yearNum = Number(streamYear);
        streamYearRange = [yearNum, yearNum];
      }

      // Apply tolerance to the stream year range
      const tolerance = yearMatchingOptions.tolerance ?? 1;
      streamYearRange[0] -= tolerance;
      streamYearRange[1] += tolerance;

      // If the requested year range and stream year range overlap, accept the stream
      const [requestedStart, requestedEnd] = requestedYearRange;
      const [streamStart, streamEnd] = streamYearRange;
      return requestedStart <= streamEnd && requestedEnd >= streamStart;
    };

    const performSeasonEpisodeMatch = (stream: ParsedStream) => {
      const seasonEpisodeMatchingOptions = this.userData.seasonEpisodeMatching;
      if (
        !seasonEpisodeMatchingOptions ||
        !seasonEpisodeMatchingOptions.enabled
      ) {
        return true;
      }

      if (!parsedId) return true;
      const requestedSeason = Number.isInteger(Number(parsedId.season))
        ? Number(parsedId.season)
        : undefined;
      const requestedEpisode = Number.isInteger(Number(parsedId.episode))
        ? Number(parsedId.episode)
        : undefined;

      if (
        seasonEpisodeMatchingOptions.requestTypes?.length &&
        (!seasonEpisodeMatchingOptions.requestTypes.includes(type) ||
          (isAnime &&
            !seasonEpisodeMatchingOptions.requestTypes.includes('anime')))
      ) {
        return true;
      }

      if (
        seasonEpisodeMatchingOptions.addons?.length &&
        !seasonEpisodeMatchingOptions.addons.includes(stream.addon.preset.id)
      ) {
        return true;
      }

      // is requested season present
      if (
        requestedSeason &&
        ((stream.parsedFile?.season &&
          stream.parsedFile.season !== requestedSeason) ||
          (stream.parsedFile?.seasons &&
            !stream.parsedFile.seasons.includes(requestedSeason)))
      ) {
        return false;
      }

      // is the present episode incorrect (does not match either the requested episode or absolute episode if present)
      if (
        requestedEpisode &&
        stream.parsedFile?.episode &&
        stream.parsedFile.episode !== requestedEpisode &&
        (requestedMetadata?.absoluteEpisode
          ? stream.parsedFile.episode !== requestedMetadata.absoluteEpisode
          : true)
      ) {
        return false;
      }

      return true;
    };

    const excludedRegexPatterns =
      isRegexAllowed &&
      this.userData.excludedRegexPatterns &&
      this.userData.excludedRegexPatterns.length > 0
        ? await Promise.all(
            this.userData.excludedRegexPatterns.map(
              async (pattern) => await compileRegex(pattern)
            )
          )
        : undefined;

    const requiredRegexPatterns =
      isRegexAllowed &&
      this.userData.requiredRegexPatterns &&
      this.userData.requiredRegexPatterns.length > 0
        ? await Promise.all(
            this.userData.requiredRegexPatterns.map(
              async (pattern) => await compileRegex(pattern)
            )
          )
        : undefined;

    const includedRegexPatterns =
      isRegexAllowed &&
      this.userData.includedRegexPatterns &&
      this.userData.includedRegexPatterns.length > 0
        ? await Promise.all(
            this.userData.includedRegexPatterns.map(
              async (pattern) => await compileRegex(pattern)
            )
          )
        : undefined;

    const excludedKeywordsPattern =
      this.userData.excludedKeywords &&
      this.userData.excludedKeywords.length > 0
        ? await formRegexFromKeywords(this.userData.excludedKeywords)
        : undefined;

    const requiredKeywordsPattern =
      this.userData.requiredKeywords &&
      this.userData.requiredKeywords.length > 0
        ? await formRegexFromKeywords(this.userData.requiredKeywords)
        : undefined;

    const includedKeywordsPattern =
      this.userData.includedKeywords &&
      this.userData.includedKeywords.length > 0
        ? await formRegexFromKeywords(this.userData.includedKeywords)
        : undefined;

    // test many regexes against many attributes and return true if at least one regex matches any attribute
    // and false if no regex matches any attribute
    const testRegexes = async (stream: ParsedStream, patterns: RegExp[]) => {
      const file = stream.parsedFile;
      const stringsToTest = [
        stream.filename,
        file?.releaseGroup,
        stream.indexer,
        stream.folderName,
      ].filter((v) => v !== undefined);

      for (const string of stringsToTest) {
        for (const pattern of patterns) {
          if (await safeRegexTest(pattern, string)) {
            return true;
          }
        }
      }
      return false;
    };

    const filterBasedOnCacheStatus = (
      stream: ParsedStream,
      mode: 'and' | 'or',
      addonIds: string[] | undefined,
      serviceIds: string[] | undefined,
      streamTypes: StreamType[] | undefined,
      cached: boolean
    ) => {
      const isAddonFilteredOut =
        addonIds &&
        addonIds.length > 0 &&
        addonIds.some((addonId) => stream.addon.preset.id === addonId) &&
        stream.service?.cached === cached;
      const isServiceFilteredOut =
        serviceIds &&
        serviceIds.length > 0 &&
        serviceIds.some((serviceId) => stream.service?.id === serviceId) &&
        stream.service?.cached === cached;
      const isStreamTypeFilteredOut =
        streamTypes &&
        streamTypes.length > 0 &&
        streamTypes.includes(stream.type) &&
        stream.service?.cached === cached;

      if (mode === 'and') {
        return !(
          isAddonFilteredOut &&
          isServiceFilteredOut &&
          isStreamTypeFilteredOut
        );
      } else {
        return !(
          isAddonFilteredOut ||
          isServiceFilteredOut ||
          isStreamTypeFilteredOut
        );
      }
    };

    const normaliseRange = (
      range: [number, number] | undefined,
      defaults: { min: number; max: number }
    ): [number | undefined, number | undefined] | undefined => {
      if (!range) return undefined;
      const [min, max] = range;
      const normMin = min === defaults.min ? undefined : min;
      const normMax = max === defaults.max ? undefined : max;
      return normMin === undefined && normMax === undefined
        ? undefined
        : [normMin, normMax];
    };

    const normaliseSeederRange = (
      seederRange: [number, number] | undefined
    ) => {
      return normaliseRange(seederRange, {
        min: constants.MIN_SEEDERS,
        max: constants.MAX_SEEDERS,
      });
    };

    const normaliseSizeRange = (sizeRange: [number, number] | undefined) => {
      return normaliseRange(sizeRange, {
        min: constants.MIN_SIZE,
        max: constants.MAX_SIZE,
      });
    };

    const getStreamType = (
      stream: ParsedStream
    ): 'p2p' | 'cached' | 'uncached' | undefined => {
      switch (stream.type) {
        case 'debrid':
          return stream.service?.cached ? 'cached' : 'uncached';
        case 'usenet':
          return stream.service?.cached ? 'cached' : 'uncached';
        case 'p2p':
          return 'p2p';
        default:
          return undefined;
      }
    };

    const shouldKeepStream = async (stream: ParsedStream): Promise<boolean> => {
      const file = stream.parsedFile;

      if (stream.addon.resultPassthrough) {
        this.incrementIncludedReason('passthrough', stream.addon.name);
        return true;
      }

      // Temporarily add in our fake visual tags used for sorting/filtering
      // HDR+DV
      if (
        file?.visualTags?.some((tag) => tag.startsWith('HDR')) &&
        file?.visualTags?.some((tag) => tag.startsWith('DV'))
      ) {
        const hdrIndex = file?.visualTags?.findIndex((tag) =>
          tag.startsWith('HDR')
        );
        const dvIndex = file?.visualTags?.findIndex((tag) =>
          tag.startsWith('DV')
        );
        const insertIndex = Math.min(hdrIndex, dvIndex);
        file?.visualTags?.splice(insertIndex, 0, 'HDR+DV');
      }
      // DV Only
      if (
        file?.visualTags?.some((tag) => tag.startsWith('DV')) &&
        !file?.visualTags?.some((tag) => tag.startsWith('HDR'))
      ) {
        file?.visualTags?.push('DV Only');
      }
      // HDR Only
      if (
        file?.visualTags?.some((tag) => tag.startsWith('HDR')) &&
        !file?.visualTags?.some((tag) => tag.startsWith('DV'))
      ) {
        file?.visualTags?.push('HDR Only');
      }

      // carry out include checks first
      if (this.userData.includedStreamTypes?.includes(stream.type)) {
        this.incrementIncludedReason('streamType', stream.type);
        return true;
      }

      if (
        this.userData.includedResolutions?.includes(
          file?.resolution || ('Unknown' as any)
        )
      ) {
        const resolution = this.userData.includedResolutions.find(
          (resolution) => (file?.resolution || 'Unknown') === resolution
        );
        if (resolution) {
          this.incrementIncludedReason('resolution', resolution);
        }
        return true;
      }

      if (
        this.userData.includedQualities?.includes(
          file?.quality || ('Unknown' as any)
        )
      ) {
        const quality = this.userData.includedQualities.find(
          (quality) => (file?.quality || 'Unknown') === quality
        );
        if (quality) {
          this.incrementIncludedReason('quality', quality);
        }
        return true;
      }

      if (
        this.userData.includedVisualTags?.some((tag) =>
          (file?.visualTags.length ? file.visualTags : ['Unknown']).includes(
            tag
          )
        )
      ) {
        const tag = this.userData.includedVisualTags.find((tag) =>
          (file?.visualTags.length ? file.visualTags : ['Unknown']).includes(
            tag
          )
        );
        if (tag) {
          this.incrementIncludedReason('visualTag', tag);
        }
        return true;
      }

      if (
        this.userData.includedAudioTags?.some((tag) =>
          (file?.audioTags.length ? file.audioTags : ['Unknown']).includes(tag)
        )
      ) {
        const tag = this.userData.includedAudioTags.find((tag) =>
          (file?.audioTags.length ? file.audioTags : ['Unknown']).includes(tag)
        );
        if (tag) {
          this.incrementIncludedReason('audioTag', tag);
        }
        return true;
      }

      if (
        this.userData.includedAudioChannels?.some((channel) =>
          (file?.audioChannels.length
            ? file.audioChannels
            : ['Unknown']
          ).includes(channel)
        )
      ) {
        const channel = this.userData.includedAudioChannels.find((channel) =>
          (file?.audioChannels.length
            ? file.audioChannels
            : ['Unknown']
          ).includes(channel)
        );
        this.incrementIncludedReason('audioChannel', channel!);
        return true;
      }

      if (
        this.userData.includedLanguages?.some((lang) =>
          (file?.languages.length ? file.languages : ['Unknown']).includes(lang)
        )
      ) {
        const lang = this.userData.includedLanguages.find((lang) =>
          (file?.languages.length ? file.languages : ['Unknown']).includes(lang)
        );
        this.incrementIncludedReason('language', lang!);
        return true;
      }

      if (
        this.userData.includedEncodes?.some(
          (encode) => (file?.encode || 'Unknown') === encode
        )
      ) {
        const encode = this.userData.includedEncodes.find(
          (encode) => (file?.encode || 'Unknown') === encode
        );
        if (encode) {
          this.incrementIncludedReason('encode', encode);
        }
        return true;
      }

      if (
        includedRegexPatterns &&
        (await testRegexes(stream, includedRegexPatterns))
      ) {
        this.incrementIncludedReason('regex', includedRegexPatterns[0].source);
        return true;
      }

      if (
        includedKeywordsPattern &&
        (await testRegexes(stream, [includedKeywordsPattern]))
      ) {
        this.incrementIncludedReason(
          'keywords',
          includedKeywordsPattern.source
        );
        return true;
      }

      const includedSeederRange = normaliseSeederRange(
        this.userData.includeSeederRange
      );
      const excludedSeederRange = normaliseSeederRange(
        this.userData.excludeSeederRange
      );
      const requiredSeederRange = normaliseSeederRange(
        this.userData.requiredSeederRange
      );

      const typeForSeederRange = getStreamType(stream);

      if (
        includedSeederRange &&
        (!this.userData.seederRangeTypes ||
          (typeForSeederRange &&
            this.userData.seederRangeTypes.includes(typeForSeederRange)))
      ) {
        if (
          includedSeederRange[0] &&
          (stream.torrent?.seeders ?? 0) > includedSeederRange[0]
        ) {
          this.incrementIncludedReason('seeder', `>${includedSeederRange[0]}`);
          return true;
        }
        if (
          includedSeederRange[1] &&
          (stream.torrent?.seeders ?? 0) < includedSeederRange[1]
        ) {
          this.incrementIncludedReason('seeder', `<${includedSeederRange[1]}`);
          return true;
        }
      }

      if (this.userData.excludedStreamTypes?.includes(stream.type)) {
        // Track stream type exclusions
        this.incrementRemovalReason('excludedStreamType', stream.type);
        return false;
      }

      // Track required stream type misses
      if (
        this.userData.requiredStreamTypes &&
        this.userData.requiredStreamTypes.length > 0 &&
        !this.userData.requiredStreamTypes.includes(stream.type)
      ) {
        this.incrementRemovalReason('requiredStreamType', stream.type);
        return false;
      }

      // Resolutions
      if (
        this.userData.excludedResolutions?.includes(
          (file?.resolution || 'Unknown') as any
        )
      ) {
        this.incrementRemovalReason(
          'excludedResolution',
          file?.resolution || 'Unknown'
        );
        return false;
      }

      if (
        this.userData.requiredResolutions &&
        this.userData.requiredResolutions.length > 0 &&
        !this.userData.requiredResolutions.includes(
          (file?.resolution || 'Unknown') as any
        )
      ) {
        this.incrementRemovalReason(
          'requiredResolution',
          file?.resolution || 'Unknown'
        );
        return false;
      }

      // Qualities
      if (
        this.userData.excludedQualities?.includes(
          (file?.quality || 'Unknown') as any
        )
      ) {
        this.incrementRemovalReason(
          'excludedQuality',
          file?.quality || 'Unknown'
        );
        return false;
      }

      if (
        this.userData.requiredQualities &&
        this.userData.requiredQualities.length > 0 &&
        !this.userData.requiredQualities.includes(
          (file?.quality || 'Unknown') as any
        )
      ) {
        this.incrementRemovalReason(
          'requiredQuality',
          file?.quality || 'Unknown'
        );
        return false;
      }

      // encode
      if (
        this.userData.excludedEncodes?.includes(
          file?.encode || ('Unknown' as any)
        )
      ) {
        this.incrementRemovalReason(
          'excludedEncode',
          file?.encode || 'Unknown'
        );
        return false;
      }

      if (
        this.userData.requiredEncodes &&
        this.userData.requiredEncodes.length > 0 &&
        !this.userData.requiredEncodes.includes(
          file?.encode || ('Unknown' as any)
        )
      ) {
        this.incrementRemovalReason(
          'requiredEncode',
          file?.encode || 'Unknown'
        );
        return false;
      }

      if (
        this.userData.excludedVisualTags?.some((tag) =>
          (file?.visualTags.length ? file.visualTags : ['Unknown']).includes(
            tag
          )
        )
      ) {
        const tag = this.userData.excludedVisualTags.find((tag) =>
          (file?.visualTags.length ? file.visualTags : ['Unknown']).includes(
            tag
          )
        );
        this.incrementRemovalReason('excludedVisualTag', tag!);
        return false;
      }

      if (
        this.userData.requiredVisualTags &&
        this.userData.requiredVisualTags.length > 0 &&
        !this.userData.requiredVisualTags.some((tag) =>
          (file?.visualTags.length ? file.visualTags : ['Unknown']).includes(
            tag
          )
        )
      ) {
        this.incrementRemovalReason(
          'requiredVisualTag',
          file?.visualTags.length ? file.visualTags.join(', ') : 'Unknown'
        );
        return false;
      }

      if (
        this.userData.excludedAudioTags?.some((tag) =>
          (file?.audioTags.length ? file.audioTags : ['Unknown']).includes(tag)
        )
      ) {
        const tag = this.userData.excludedAudioTags.find((tag) =>
          (file?.audioTags.length ? file.audioTags : ['Unknown']).includes(tag)
        );
        this.incrementRemovalReason('excludedAudioTag', tag!);
        return false;
      }

      if (
        this.userData.requiredAudioTags &&
        this.userData.requiredAudioTags.length > 0 &&
        !this.userData.requiredAudioTags.some((tag) =>
          (file?.audioTags.length ? file.audioTags : ['Unknown']).includes(tag)
        )
      ) {
        this.incrementRemovalReason(
          'requiredAudioTag',
          file?.audioTags.length ? file.audioTags.join(', ') : 'Unknown'
        );
        return false;
      }

      if (
        this.userData.excludedAudioChannels?.some((channel) =>
          (file?.audioChannels.length
            ? file.audioChannels
            : ['Unknown']
          ).includes(channel)
        )
      ) {
        const channel = this.userData.excludedAudioChannels.find((channel) =>
          (file?.audioChannels.length
            ? file.audioChannels
            : ['Unknown']
          ).includes(channel)
        );
        this.incrementRemovalReason('excludedAudioChannel', channel!);
        return false;
      }

      if (
        this.userData.requiredAudioChannels &&
        this.userData.requiredAudioChannels.length > 0 &&
        !this.userData.requiredAudioChannels.some((channel) =>
          (file?.audioChannels.length
            ? file.audioChannels
            : ['Unknown']
          ).includes(channel)
        )
      ) {
        this.incrementRemovalReason(
          'requiredAudioChannel',
          file?.audioChannels.length ? file.audioChannels.join(', ') : 'Unknown'
        );
        return false;
      }

      // languages
      if (
        this.userData.excludedLanguages?.length &&
        (file?.languages.length ? file.languages : ['Unknown']).every((lang) =>
          this.userData.excludedLanguages!.includes(lang as any)
        )
      ) {
        this.incrementRemovalReason(
          'excludedLanguage',
          file?.languages.length ? file.languages.join(', ') : 'Unknown'
        );
        return false;
      }

      if (
        this.userData.requiredLanguages &&
        this.userData.requiredLanguages.length > 0 &&
        !this.userData.requiredLanguages.some((lang) =>
          (file?.languages.length ? file.languages : ['Unknown']).includes(lang)
        )
      ) {
        this.incrementRemovalReason(
          'requiredLanguage',
          file?.languages.length ? file.languages.join(', ') : 'Unknown'
        );
        return false;
      }

      // uncached

      if (this.userData.excludeUncached && stream.service?.cached === false) {
        this.incrementRemovalReason('excludedUncached');
        return false;
      }

      if (this.userData.excludeCached && stream.service?.cached === true) {
        this.incrementRemovalReason('excludedCached');
        return false;
      }

      if (
        filterBasedOnCacheStatus(
          stream,
          this.userData.excludeCachedMode || 'or',
          this.userData.excludeCachedFromAddons,
          this.userData.excludeCachedFromServices,
          this.userData.excludeCachedFromStreamTypes,
          true
        ) === false
      ) {
        this.incrementRemovalReason('excludedCached');
        return false;
      }

      if (
        filterBasedOnCacheStatus(
          stream,
          this.userData.excludeUncachedMode || 'or',
          this.userData.excludeUncachedFromAddons,
          this.userData.excludeUncachedFromServices,
          this.userData.excludeUncachedFromStreamTypes,
          false
        ) === false
      ) {
        this.incrementRemovalReason('excludedUncached');
        return false;
      }

      if (
        excludedRegexPatterns &&
        (await testRegexes(stream, excludedRegexPatterns))
      ) {
        this.incrementRemovalReason('excludedRegex');
        return false;
      }
      if (
        requiredRegexPatterns &&
        requiredRegexPatterns.length > 0 &&
        !(await testRegexes(stream, requiredRegexPatterns))
      ) {
        this.incrementRemovalReason('requiredRegex');
        return false;
      }

      if (
        excludedKeywordsPattern &&
        (await testRegexes(stream, [excludedKeywordsPattern]))
      ) {
        this.incrementRemovalReason('excludedKeywords');
        return false;
      }

      if (
        requiredKeywordsPattern &&
        !(await testRegexes(stream, [requiredKeywordsPattern]))
      ) {
        this.incrementRemovalReason('requiredKeywords');
        return false;
      }

      if (
        requiredSeederRange &&
        (!this.userData.seederRangeTypes ||
          (typeForSeederRange &&
            this.userData.seederRangeTypes.includes(typeForSeederRange)))
      ) {
        if (
          requiredSeederRange[0] &&
          (stream.torrent?.seeders ?? 0) < requiredSeederRange[0]
        ) {
          this.incrementRemovalReason(
            'requiredSeederRange',
            `< ${requiredSeederRange[0]}`
          );
          return false;
        }
        if (
          stream.torrent?.seeders !== undefined &&
          requiredSeederRange[1] &&
          (stream.torrent?.seeders ?? 0) > requiredSeederRange[1]
        ) {
          this.incrementRemovalReason(
            'requiredSeederRange',
            `> ${requiredSeederRange[1]}`
          );
          return false;
        }
      }

      if (
        excludedSeederRange &&
        (!this.userData.seederRangeTypes ||
          (typeForSeederRange &&
            this.userData.seederRangeTypes.includes(typeForSeederRange)))
      ) {
        if (
          excludedSeederRange[0] &&
          (stream.torrent?.seeders ?? 0) > excludedSeederRange[0]
        ) {
          this.incrementRemovalReason(
            'excludedSeederRange',
            `< ${excludedSeederRange[0]}`
          );
          return false;
        }
        if (
          excludedSeederRange[1] &&
          (stream.torrent?.seeders ?? 0) < excludedSeederRange[1]
        ) {
          this.incrementRemovalReason(
            'excludedSeederRange',
            `> ${excludedSeederRange[1]}`
          );
          return false;
        }
      }

      if (!performTitleMatch(stream)) {
        this.incrementRemovalReason(
          'titleMatching',
          `${stream.parsedFile?.title || 'Unknown Title'}${type === 'movie' ? ` - (${stream.parsedFile?.year || 'Unknown Year'})` : ''}`
        );
        return false;
      }

      if (!performYearMatch(stream)) {
        this.incrementRemovalReason(
          'yearMatching',
          `${stream.parsedFile?.title || 'Unknown Title'} - ${stream.parsedFile?.year || 'Unknown Year'}`
        );
        return false;
      }

      if (!performSeasonEpisodeMatch(stream)) {
        const detail =
          stream.parsedFile?.title +
          ' ' +
          (stream.parsedFile?.seasonEpisode?.join(' x ') || 'Unknown');

        this.incrementRemovalReason('seasonEpisodeMatching', detail);
        return false;
      }

      const global = this.userData.size?.global;
      const resolution = stream.parsedFile?.resolution
        ? this.userData.size?.resolution?.[
            stream.parsedFile
              .resolution as keyof typeof this.userData.size.resolution
          ]
        : undefined;

      let minMax: [number | undefined, number | undefined] | undefined;
      if (type === 'movie') {
        minMax =
          normaliseSizeRange(resolution?.movies) ||
          normaliseSizeRange(global?.movies);
      } else {
        minMax =
          normaliseSizeRange(resolution?.series) ||
          normaliseSizeRange(global?.series);
      }

      if (minMax) {
        if (stream.size && minMax[0] && stream.size < minMax[0]) {
          this.incrementRemovalReason(
            'size',
            `< ${formatBytes(minMax[0], 1000)}`
          );
          return false;
        }
        if (stream.size && minMax[1] && stream.size > minMax[1]) {
          this.incrementRemovalReason(
            'size',
            `> ${formatBytes(minMax[1], 1000)}`
          );
          return false;
        }
      }

      return true;
    };

    const includedStreamsByExpression =
      await this.applyIncludedStreamExpressions(streams, type, id);
    if (includedStreamsByExpression.length > 0) {
      logger.info(
        `${includedStreamsByExpression.length} streams were included by stream expressions`
      );
    }

    const filterableStreams = streams.filter(
      (stream) => !includedStreamsByExpression.some((s) => s.id === stream.id)
    );

    const filterResults = await Promise.all(
      filterableStreams.map(shouldKeepStream)
    );

    let filteredStreams = filterableStreams.filter(
      (_, index) => filterResults[index]
    );

    const finalStreams = StreamUtils.mergeStreams([
      ...includedStreamsByExpression,
      ...filteredStreams,
    ]);

    // L// filter summary
    const totalFiltered = streams.length - finalStreams.length;

    const summary = [
      '\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      `  🔍 Filter Summary`,
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      `  📊 Total Streams : ${streams.length}`,
      `  ✔️ Kept         : ${finalStreams.length}`,
      `  ❌ Filtered     : ${totalFiltered}`,
    ];

    // Add filter details if any streams were filtered
    const { filterDetails, includedDetails } = this.getFormattedFilterDetails();

    if (filterDetails.length > 0) {
      summary.push('\n  🔎 Filter Details:');
      summary.push(...filterDetails);
    }
    if (includedDetails.length > 0) {
      summary.push('\n  🔎 Included Details:');
      summary.push(...includedDetails);
    }
    summary.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logger.info(summary.join('\n'));

    logger.info(`Applied filters in ${getTimeTakenSincePoint(start)}`);
    return finalStreams;
  }

  public async applyIncludedStreamExpressions(
    streams: ParsedStream[],
    type: string,
    id: string
  ): Promise<ParsedStream[]> {
    let queryType = type;

    if (AnimeDatabase.getInstance().isAnime(id)) {
      queryType = 'anime';
    }
    const selector = new StreamSelector(queryType);
    const streamsToKeep = new Set<string>();
    if (
      !this.userData.includedStreamExpressions ||
      this.userData.includedStreamExpressions.length === 0
    ) {
      return [];
    }
    for (const expression of this.userData.includedStreamExpressions) {
      const selectedStreams = await selector.select(streams, expression);
      this.filterStatistics.included.streamExpression.total +=
        selectedStreams.length;
      this.filterStatistics.included.streamExpression.details[expression] =
        (this.filterStatistics.included.streamExpression.details[expression] ||
          0) + selectedStreams.length;
      selectedStreams.forEach((stream) => streamsToKeep.add(stream.id));
    }
    return streams.filter((stream) => streamsToKeep.has(stream.id));
  }

  public async applyStreamExpressionFilters(
    streams: ParsedStream[],
    type: string,
    id: string
  ): Promise<ParsedStream[]> {
    let queryType = type;

    if (AnimeDatabase.getInstance().isAnime(id)) {
      queryType = 'anime';
    }

    const passthroughStreams = streams
      .filter((stream) => stream.addon.resultPassthrough)
      .map((stream) => stream.id);
    if (
      this.userData.excludedStreamExpressions &&
      this.userData.excludedStreamExpressions.length > 0
    ) {
      const selector = new StreamSelector(queryType);
      const streamsToRemove = new Set<string>(); // Track actual stream objects to be removed

      for (const expression of this.userData.excludedStreamExpressions) {
        try {
          // Always select from the current filteredStreams (not yet modified by this loop)
          const selectedStreams = await selector.select(
            streams.filter((stream) => !streamsToRemove.has(stream.id)),
            expression
          );

          // Track these stream objects for removal
          selectedStreams.forEach(
            (stream) =>
              !passthroughStreams.includes(stream.id) &&
              streamsToRemove.add(stream.id)
          );

          // Update skip reasons for this condition (only count newly selected streams)
          if (selectedStreams.length > 0) {
            this.filterStatistics.removed.excludedFilterCondition.total +=
              selectedStreams.length;
            this.filterStatistics.removed.excludedFilterCondition.details[
              expression
            ] =
              (this.filterStatistics.removed.excludedFilterCondition.details[
                expression
              ] || 0) + selectedStreams.length;
          }
        } catch (error) {
          logger.error(
            `Failed to apply excluded stream expression "${expression}": ${error instanceof Error ? error.message : String(error)}`
          );
          // Continue with the next condition instead of breaking the entire loop
        }
      }

      logger.verbose(
        `Total streams selected by excluded conditions: ${streamsToRemove.size}`
      );

      // Remove all marked streams at once, after processing all conditions
      streams = streams.filter((stream) => !streamsToRemove.has(stream.id));
    }

    if (
      this.userData.requiredStreamExpressions &&
      this.userData.requiredStreamExpressions.length > 0
    ) {
      const selector = new StreamSelector(queryType);
      const streamsToKeep = new Set<string>(); // Track actual stream objects to be removed
      passthroughStreams.forEach((stream) => streamsToKeep.add(stream));

      for (const expression of this.userData.requiredStreamExpressions) {
        try {
          const selectedStreams = await selector.select(
            streams.filter((stream) => !streamsToKeep.has(stream.id)),
            expression
          );

          // Track these stream objects to keep
          selectedStreams.forEach((stream) => streamsToKeep.add(stream.id));

          // Update skip reasons for this condition (only count newly selected streams)
          if (selectedStreams.length > 0) {
            this.filterStatistics.removed.requiredFilterCondition.total +=
              selectedStreams.length;
            this.filterStatistics.removed.requiredFilterCondition.details[
              expression
            ] =
              (this.filterStatistics.removed.requiredFilterCondition.details[
                expression
              ] || 0) + selectedStreams.length;
          }
        } catch (error) {
          logger.error(
            `Failed to apply required stream expression "${expression}": ${error instanceof Error ? error.message : String(error)}`
          );
          // Continue with the next condition instead of breaking the entire loop
        }
      }

      logger.verbose(
        `Total streams selected by required conditions: ${streamsToKeep.size} (including ${passthroughStreams.length} passthrough streams)`
      );
      // remove all streams that are not in the streamsToKeep set
      streams = streams.filter((stream) => streamsToKeep.has(stream.id));
    }
    return streams;
  }
}

export default StreamFilterer;
