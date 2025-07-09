import { ParsedStream, UserData } from '../db/schemas';
import {
  createLogger,
  FeatureControl,
  Metadata,
  getTimeTakenSincePoint,
  TMDBMetadata,
  constants,
} from '../utils';
import { TYPES } from '../utils/constants';
import { compileRegex } from '../utils/regex';
import { formRegexFromKeywords } from '../utils/regex';
import { safeRegexTest } from '../utils/regex';
import { StreamType } from '../utils/constants';
import { StreamSelector } from '../parser/streamExpression';
import StreamUtils from './utils';

const logger = createLogger('filterer');

class StreamFilterer {
  private userData: UserData;

  constructor(userData: UserData) {
    this.userData = userData;
  }

  public async filter(
    streams: ParsedStream[],
    type: string,
    id: string
  ): Promise<ParsedStream[]> {
    interface SkipReason {
      total: number;
      details: Record<string, number>;
    }
    const isAnime = id.startsWith('kitsu');
    const skipReasons: Record<string, SkipReason> = {
      titleMatching: { total: 0, details: {} },
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
      requiredCached: { total: 0, details: {} },
      excludedUncached: { total: 0, details: {} },
      requiredUncached: { total: 0, details: {} },
      excludedRegex: { total: 0, details: {} },
      requiredRegex: { total: 0, details: {} },
      excludedKeywords: { total: 0, details: {} },
      requiredKeywords: { total: 0, details: {} },
      requiredSeederRange: { total: 0, details: {} },
      excludedSeederRange: { total: 0, details: {} },
      excludedFilterCondition: { total: 0, details: {} },
      requiredFilterCondition: { total: 0, details: {} },
      size: { total: 0, details: {} },
    };

    const includedReasons: Record<string, SkipReason> = {
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
    };

    const start = Date.now();
    const isRegexAllowed = FeatureControl.isRegexAllowed(this.userData);

    let requestedMetadata: Metadata | undefined;
    if (this.userData.titleMatching?.enabled && TYPES.includes(type as any)) {
      try {
        requestedMetadata = await new TMDBMetadata(
          this.userData.tmdbAccessToken
        ).getMetadata(id, type as any);
        logger.info(`Fetched metadata for ${id}`, requestedMetadata);
      } catch (error) {
        logger.error(`Error fetching titles for ${id}: ${error}`);
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
      // const titleMatchingOptions = this.userData.titleMatching;
      const titleMatchingOptions = {
        mode: 'exact',
        ...(this.userData.titleMatching ?? {}),
      };
      if (!titleMatchingOptions || !titleMatchingOptions.enabled) {
        return true;
      }
      if (!requestedMetadata || requestedMetadata.titles.length === 0) {
        return true;
      }

      const streamTitle = stream.parsedFile?.title;
      const streamYear = stream.parsedFile?.year;
      // now check if we need to check this stream based on the addon and request type
      if (
        titleMatchingOptions.requestTypes?.length &&
        (!titleMatchingOptions.requestTypes.includes(type) ||
          (isAnime && !titleMatchingOptions.requestTypes.includes('anime')))
      ) {
        return true;
      }

      if (
        titleMatchingOptions.addons?.length &&
        !titleMatchingOptions.addons.includes(stream.addon.presetInstanceId)
      ) {
        return true;
      }

      if (
        !streamTitle ||
        (titleMatchingOptions.matchYear && !streamYear && type === 'movie')
      ) {
        // only filter out movies without a year as series results usually don't include a year
        return false;
      }
      const yearMatch =
        titleMatchingOptions.matchYear && streamYear
          ? requestedMetadata?.year === streamYear
          : true;

      if (titleMatchingOptions.mode === 'exact') {
        return (
          requestedMetadata?.titles.some(
            (title) => normaliseTitle(title) === normaliseTitle(streamTitle)
          ) && yearMatch
        );
      } else {
        return (
          requestedMetadata?.titles.some((title) =>
            normaliseTitle(streamTitle).includes(normaliseTitle(title))
          ) && yearMatch
        );
      }
    };

    const performSeasonEpisodeMatch = (stream: ParsedStream) => {
      const seasonEpisodeMatchingOptions = this.userData.seasonEpisodeMatching;
      if (
        !seasonEpisodeMatchingOptions ||
        !seasonEpisodeMatchingOptions.enabled
      ) {
        return true;
      }

      // parse the id to get the season and episode
      const seasonEpisodeRegex = /:(\d+):(\d+)$/;
      const match = id.match(seasonEpisodeRegex);

      if (!match || !match[1] || !match[2]) {
        // only if both season and episode are present, we can filter
        return true;
      }

      const requestedSeason = parseInt(match[1]);
      const requestedEpisode = parseInt(match[2]);

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
        !seasonEpisodeMatchingOptions.addons.includes(
          stream.addon.presetInstanceId
        )
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

      // is requested episode present
      if (
        requestedEpisode &&
        stream.parsedFile?.episode &&
        stream.parsedFile.episode !== requestedEpisode
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
        addonIds.some((addonId) => stream.addon.presetInstanceId === addonId) &&
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

      // carry out include checks first
      if (this.userData.includedStreamTypes?.includes(stream.type)) {
        includedReasons.streamType.total++;
        includedReasons.streamType.details[stream.type] =
          (includedReasons.streamType.details[stream.type] || 0) + 1;
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
          includedReasons.resolution.total++;
          includedReasons.resolution.details[resolution] =
            (includedReasons.resolution.details[resolution] || 0) + 1;
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
          includedReasons.quality.total++;
          includedReasons.quality.details[quality] =
            (includedReasons.quality.details[quality] || 0) + 1;
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
          includedReasons.visualTag.total++;
          includedReasons.visualTag.details[tag] =
            (includedReasons.visualTag.details[tag] || 0) + 1;
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
          includedReasons.audioTag.total++;
          includedReasons.audioTag.details[tag] =
            (includedReasons.audioTag.details[tag] || 0) + 1;
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
        includedReasons.audioChannel.total++;
        includedReasons.audioChannel.details[channel!] =
          (includedReasons.audioChannel.details[channel!] || 0) + 1;
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
        includedReasons.language.total++;
        includedReasons.language.details[lang!] =
          (includedReasons.language.details[lang!] || 0) + 1;
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
          includedReasons.encode.total++;
          includedReasons.encode.details[encode] =
            (includedReasons.encode.details[encode] || 0) + 1;
        }
        return true;
      }

      if (
        includedRegexPatterns &&
        (await testRegexes(stream, includedRegexPatterns))
      ) {
        includedReasons.regex.total++;
        includedReasons.regex.details[includedRegexPatterns[0].source] =
          (includedReasons.regex.details[includedRegexPatterns[0].source] ||
            0) + 1;
        return true;
      }

      if (
        includedKeywordsPattern &&
        (await testRegexes(stream, [includedKeywordsPattern]))
      ) {
        includedReasons.keywords.total++;
        includedReasons.keywords.details[includedKeywordsPattern.source] =
          (includedReasons.keywords.details[includedKeywordsPattern.source] ||
            0) + 1;
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
          includedReasons.seeder.total++;
          includedReasons.seeder.details[includedSeederRange[0]] =
            (includedReasons.seeder.details[includedSeederRange[0]] || 0) + 1;
          return true;
        }
        if (
          includedSeederRange[1] &&
          (stream.torrent?.seeders ?? 0) < includedSeederRange[1]
        ) {
          includedReasons.seeder.total++;
          includedReasons.seeder.details[includedSeederRange[1]] =
            (includedReasons.seeder.details[includedSeederRange[1]] || 0) + 1;
          return true;
        }
      }

      if (this.userData.excludedStreamTypes?.includes(stream.type)) {
        // Track stream type exclusions
        skipReasons.excludedStreamType.total++;
        skipReasons.excludedStreamType.details[stream.type] =
          (skipReasons.excludedStreamType.details[stream.type] || 0) + 1;
        return false;
      }

      // Track required stream type misses
      if (
        this.userData.requiredStreamTypes &&
        this.userData.requiredStreamTypes.length > 0 &&
        !this.userData.requiredStreamTypes.includes(stream.type)
      ) {
        skipReasons.requiredStreamType.total++;
        skipReasons.requiredStreamType.details[stream.type] =
          (skipReasons.requiredStreamType.details[stream.type] || 0) + 1;
        return false;
      }

      // Resolutions
      if (
        this.userData.excludedResolutions?.includes(
          (file?.resolution || 'Unknown') as any
        )
      ) {
        skipReasons.excludedResolution.total++;
        skipReasons.excludedResolution.details[file?.resolution || 'Unknown'] =
          (skipReasons.excludedResolution.details[
            file?.resolution || 'Unknown'
          ] || 0) + 1;
        return false;
      }

      if (
        this.userData.requiredResolutions &&
        this.userData.requiredResolutions.length > 0 &&
        !this.userData.requiredResolutions.includes(
          (file?.resolution || 'Unknown') as any
        )
      ) {
        skipReasons.requiredResolution.total++;
        skipReasons.requiredResolution.details[file?.resolution || 'Unknown'] =
          (skipReasons.requiredResolution.details[
            file?.resolution || 'Unknown'
          ] || 0) + 1;
        return false;
      }

      // Qualities
      if (
        this.userData.excludedQualities?.includes(
          (file?.quality || 'Unknown') as any
        )
      ) {
        skipReasons.excludedQuality.total++;
        skipReasons.excludedQuality.details[file?.quality || 'Unknown'] =
          (skipReasons.excludedQuality.details[file?.quality || 'Unknown'] ||
            0) + 1;
        return false;
      }

      if (
        this.userData.requiredQualities &&
        this.userData.requiredQualities.length > 0 &&
        !this.userData.requiredQualities.includes(
          (file?.quality || 'Unknown') as any
        )
      ) {
        skipReasons.requiredQuality.total++;
        skipReasons.requiredQuality.details[file?.quality || 'Unknown'] =
          (skipReasons.requiredQuality.details[file?.quality || 'Unknown'] ||
            0) + 1;
        return false;
      }

      // encode
      if (
        this.userData.excludedEncodes?.includes(
          file?.encode || ('Unknown' as any)
        )
      ) {
        skipReasons.excludedEncode.total++;
        skipReasons.excludedEncode.details[file?.encode || 'Unknown'] =
          (skipReasons.excludedEncode.details[file?.encode || 'Unknown'] || 0) +
          1;
        return false;
      }

      if (
        this.userData.requiredEncodes &&
        this.userData.requiredEncodes.length > 0 &&
        !this.userData.requiredEncodes.includes(
          file?.encode || ('Unknown' as any)
        )
      ) {
        skipReasons.requiredEncode.total++;
        skipReasons.requiredEncode.details[file?.encode || 'Unknown'] =
          (skipReasons.requiredEncode.details[file?.encode || 'Unknown'] || 0) +
          1;
        return false;
      }

      // temporarily add HDR+DV to visual tags list if both HDR and DV are present
      // to allow HDR+DV option in userData to work
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
        skipReasons.excludedVisualTag.total++;
        skipReasons.excludedVisualTag.details[tag!] =
          (skipReasons.excludedVisualTag.details[tag!] || 0) + 1;
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
        const tag = this.userData.requiredVisualTags.find((tag) =>
          (file?.visualTags.length ? file.visualTags : ['Unknown']).includes(
            tag
          )
        );
        skipReasons.requiredVisualTag.total++;
        skipReasons.requiredVisualTag.details[tag!] =
          (skipReasons.requiredVisualTag.details[tag!] || 0) + 1;
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
        skipReasons.excludedAudioTag.total++;
        skipReasons.excludedAudioTag.details[tag!] =
          (skipReasons.excludedAudioTag.details[tag!] || 0) + 1;
        return false;
      }

      if (
        this.userData.requiredAudioTags &&
        this.userData.requiredAudioTags.length > 0 &&
        !this.userData.requiredAudioTags.some((tag) =>
          (file?.audioTags.length ? file.audioTags : ['Unknown']).includes(tag)
        )
      ) {
        const tag = this.userData.requiredAudioTags.find((tag) =>
          (file?.audioTags.length ? file.audioTags : ['Unknown']).includes(tag)
        );
        skipReasons.requiredAudioTag.total++;
        skipReasons.requiredAudioTag.details[tag!] =
          (skipReasons.requiredAudioTag.details[tag!] || 0) + 1;
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
        skipReasons.excludedAudioChannel.total++;
        skipReasons.excludedAudioChannel.details[channel!] =
          (skipReasons.excludedAudioChannel.details[channel!] || 0) + 1;
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
        const channel = this.userData.requiredAudioChannels.find((channel) =>
          (file?.audioChannels.length
            ? file.audioChannels
            : ['Unknown']
          ).includes(channel)
        );
        skipReasons.requiredAudioChannel.total++;
        skipReasons.requiredAudioChannel.details[channel!] =
          (skipReasons.requiredAudioChannel.details[channel!] || 0) + 1;
        return false;
      }

      // languages
      if (
        this.userData.excludedLanguages?.length &&
        (file?.languages.length ? file.languages : ['Unknown']).every((lang) =>
          this.userData.excludedLanguages!.includes(lang as any)
        )
      ) {
        const lang = file?.languages[0] || 'Unknown';
        skipReasons.excludedLanguage.total++;
        skipReasons.excludedLanguage.details[lang] =
          (skipReasons.excludedLanguage.details[lang] || 0) + 1;
        return false;
      }

      if (
        this.userData.requiredLanguages &&
        this.userData.requiredLanguages.length > 0 &&
        !this.userData.requiredLanguages.some((lang) =>
          (file?.languages.length ? file.languages : ['Unknown']).includes(lang)
        )
      ) {
        const lang = this.userData.requiredLanguages.find((lang) =>
          (file?.languages.length ? file.languages : ['Unknown']).includes(lang)
        );
        skipReasons.requiredLanguage.total++;
        skipReasons.requiredLanguage.details[lang!] =
          (skipReasons.requiredLanguage.details[lang!] || 0) + 1;
        return false;
      }

      // uncached

      if (this.userData.excludeUncached && stream.service?.cached === false) {
        skipReasons.excludedUncached.total++;
        return false;
      }

      if (this.userData.excludeCached && stream.service?.cached === true) {
        skipReasons.excludedCached.total++;
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
        skipReasons.excludedCached.total++;
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
        skipReasons.excludedUncached.total++;
        return false;
      }

      if (
        excludedRegexPatterns &&
        (await testRegexes(stream, excludedRegexPatterns))
      ) {
        skipReasons.excludedRegex.total++;
        return false;
      }
      if (
        requiredRegexPatterns &&
        requiredRegexPatterns.length > 0 &&
        !(await testRegexes(stream, requiredRegexPatterns))
      ) {
        skipReasons.requiredRegex.total++;
        return false;
      }

      if (
        excludedKeywordsPattern &&
        (await testRegexes(stream, [excludedKeywordsPattern]))
      ) {
        skipReasons.excludedKeywords.total++;
        return false;
      }

      if (
        requiredKeywordsPattern &&
        !(await testRegexes(stream, [requiredKeywordsPattern]))
      ) {
        skipReasons.requiredKeywords.total++;
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
          skipReasons.requiredSeederRange.total++;
          skipReasons.requiredSeederRange.details[
            `Less than ${requiredSeederRange[0]}`
          ] =
            (skipReasons.requiredSeederRange.details[
              `Less than ${requiredSeederRange[0]}`
            ] || 0) + 1;
          return false;
        }
        if (
          stream.torrent?.seeders !== undefined &&
          requiredSeederRange[1] &&
          (stream.torrent?.seeders ?? 0) > requiredSeederRange[1]
        ) {
          skipReasons.requiredSeederRange.total++;
          skipReasons.requiredSeederRange.details[
            `Greater than ${requiredSeederRange[1]}`
          ] =
            (skipReasons.requiredSeederRange.details[
              `Greater than ${requiredSeederRange[1]}`
            ] || 0) + 1;
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
          skipReasons.excludedSeederRange.total++;
          skipReasons.excludedSeederRange.details[
            `Less than ${excludedSeederRange[0]}`
          ] =
            (skipReasons.excludedSeederRange.details[
              `Less than ${excludedSeederRange[0]}`
            ] || 0) + 1;
          return false;
        }
        if (
          excludedSeederRange[1] &&
          (stream.torrent?.seeders ?? 0) < excludedSeederRange[1]
        ) {
          skipReasons.excludedSeederRange.total++;
          skipReasons.excludedSeederRange.details[
            `Greater than ${excludedSeederRange[1]}`
          ] =
            (skipReasons.excludedSeederRange.details[
              `Greater than ${excludedSeederRange[1]}`
            ] || 0) + 1;
          return false;
        }
      }

      if (!performTitleMatch(stream)) {
        skipReasons.titleMatching.total++;
        skipReasons.titleMatching.details[
          `${stream.parsedFile?.title || 'Unknown Title'}${type === 'movie' ? ` - (${stream.parsedFile?.year || 'Unknown Year'})` : ''}`
        ] =
          (skipReasons.titleMatching.details[
            `${stream.parsedFile?.title || 'Unknown Title'}${type === 'movie' ? ` - (${stream.parsedFile?.year || 'Unknown Year'})` : ''}`
          ] || 0) + 1;
        return false;
      }

      if (!performSeasonEpisodeMatch(stream)) {
        const detail =
          stream.parsedFile?.title +
          ' ' +
          (stream.parsedFile?.seasonEpisode?.join(' x ') || 'Unknown');

        skipReasons.seasonEpisodeMatching.total++;
        skipReasons.seasonEpisodeMatching.details[detail] =
          (skipReasons.seasonEpisodeMatching.details[detail] || 0) + 1;
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
          skipReasons.size.total++;
          return false;
        }
        if (stream.size && minMax[1] && stream.size > minMax[1]) {
          skipReasons.size.total++;
          return false;
        }
      }

      return true;
    };

    const includedStreamsByExpression =
      await this.applyIncludedStreamExpressions(streams);
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

    // Log filter summary
    const totalFiltered = streams.length - finalStreams.length;
    if (totalFiltered > 0) {
      const summary = [
        '\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        `  🔍 Filter Summary`,
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        `  📊 Total Streams : ${streams.length}`,
        `  ✔️ Kept         : ${finalStreams.length}`,
        `  ❌ Filtered     : ${totalFiltered}`,
      ];

      // Add filter details if any streams were filtered
      const filterDetails: string[] = [];
      for (const [reason, stats] of Object.entries(skipReasons)) {
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
      for (const [reason, stats] of Object.entries(includedReasons)) {
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
    }

    logger.info(`Applied filters in ${getTimeTakenSincePoint(start)}`);
    return finalStreams;
  }

  public async applyIncludedStreamExpressions(
    streams: ParsedStream[]
  ): Promise<ParsedStream[]> {
    const selector = new StreamSelector();
    const streamsToKeep = new Set<string>();
    if (
      !this.userData.includedStreamExpressions ||
      this.userData.includedStreamExpressions.length === 0
    ) {
      return [];
    }
    for (const expression of this.userData.includedStreamExpressions) {
      const selectedStreams = await selector.select(streams, expression);
      selectedStreams.forEach((stream) => streamsToKeep.add(stream.id));
    }
    return streams.filter((stream) => streamsToKeep.has(stream.id));
  }

  public async applyStreamExpressionFilters(
    streams: ParsedStream[]
  ): Promise<ParsedStream[]> {
    const skipReasons: Record<
      string,
      { total: number; details: Record<string, number> }
    > = {
      excludedFilterCondition: {
        total: 0,
        details: {},
      },
      requiredFilterCondition: {
        total: 0,
        details: {},
      },
    };
    if (
      this.userData.excludedStreamExpressions &&
      this.userData.excludedStreamExpressions.length > 0
    ) {
      const selector = new StreamSelector();
      const streamsToRemove = new Set<string>(); // Track actual stream objects to be removed

      for (const expression of this.userData.excludedStreamExpressions) {
        try {
          // Always select from the current filteredStreams (not yet modified by this loop)
          const selectedStreams = await selector.select(
            streams.filter((stream) => !streamsToRemove.has(stream.id)),
            expression
          );

          // Track these stream objects for removal
          selectedStreams.forEach((stream) => streamsToRemove.add(stream.id));

          // Update skip reasons for this condition (only count newly selected streams)
          if (selectedStreams.length > 0) {
            skipReasons.excludedFilterCondition.total += selectedStreams.length;
            skipReasons.excludedFilterCondition.details[expression] =
              selectedStreams.length;
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
      const selector = new StreamSelector();
      const streamsToKeep = new Set<string>(); // Track actual stream objects to be removed

      for (const expression of this.userData.requiredStreamExpressions) {
        try {
          const selectedStreams = await selector.select(
            streams.filter((stream) => !streamsToKeep.has(stream.id)),
            expression
          );

          // Track these stream objects for removal
          selectedStreams.forEach((stream) => streamsToKeep.add(stream.id));

          // Update skip reasons for this condition (only count newly selected streams)
          if (selectedStreams.length > 0) {
            skipReasons.requiredFilterCondition.total +=
              streams.length - selectedStreams.length;
            skipReasons.requiredFilterCondition.details[expression] =
              streams.length - selectedStreams.length;
          }
        } catch (error) {
          logger.error(
            `Failed to apply required stream expression "${expression}": ${error instanceof Error ? error.message : String(error)}`
          );
          // Continue with the next condition instead of breaking the entire loop
        }
      }

      logger.verbose(
        `Total streams selected by required conditions: ${streamsToKeep.size}`
      );
      // remove all streams that are not in the streamsToKeep set
      streams = streams.filter((stream) => streamsToKeep.has(stream.id));
    }
    return streams;
  }
}

export default StreamFilterer;
