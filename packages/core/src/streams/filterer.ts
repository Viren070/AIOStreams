import { ParsedStream, UserData } from '../db/schemas.js';
import {
  createLogger,
  FeatureControl,
  getTimeTakenSincePoint,
  constants,
  compileRegex,
  formRegexFromKeywords,
  safeRegexTest,
} from '../utils/index.js';
import { LANGUAGES, StreamType } from '../utils/constants.js';
import { StreamSelector } from '../parser/streamExpression.js';
import StreamUtils, { shouldPassthroughStage } from './utils.js';
import {
  normaliseTitle,
  preprocessTitle,
  titleMatch,
} from '../parser/utils.js';
import { partial_ratio } from 'fuzzball';
import { calculateAbsoluteEpisode } from '../builtins/utils/general.js';
import {
  formatBitrate,
  formatBytes,
  iso6391ToLanguage,
} from '../formatters/utils.js';
import { ReleaseDate } from '../metadata/tmdb.js';
import { StreamContext, ExtendedMetadata } from './context.js';

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
    excludeSeasonPacks: Reason;
    noDigitalRelease: Reason;
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
    excludedReleaseGroup: Reason;
    requiredReleaseGroup: Reason;
    excludedCached: Reason;
    excludedUncached: Reason;
    excludedRegex: Reason;
    requiredRegex: Reason;
    excludedKeywords: Reason;
    requiredKeywords: Reason;
    excludedSeederRange: Reason;
    requiredSeederRange: Reason;
    excludedAgeRange: Reason;
    requiredAgeRange: Reason;
    excludedFilterCondition: Reason;
    requiredFilterCondition: Reason;
    size: Reason;
    bitrate: Reason;
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
    releaseGroup: Reason;
    size: Reason;
    seeder: Reason;
    age: Reason;
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
        excludeSeasonPacks: { total: 0, details: {} },
        noDigitalRelease: { total: 0, details: {} },
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
        excludedReleaseGroup: { total: 0, details: {} },
        requiredReleaseGroup: { total: 0, details: {} },
        excludedCached: { total: 0, details: {} },
        excludedUncached: { total: 0, details: {} },
        excludedRegex: { total: 0, details: {} },
        requiredRegex: { total: 0, details: {} },
        excludedKeywords: { total: 0, details: {} },
        requiredKeywords: { total: 0, details: {} },
        excludedSeederRange: { total: 0, details: {} },
        requiredSeederRange: { total: 0, details: {} },
        excludedAgeRange: { total: 0, details: {} },
        requiredAgeRange: { total: 0, details: {} },
        excludedFilterCondition: { total: 0, details: {} },
        requiredFilterCondition: { total: 0, details: {} },
        size: { total: 0, details: {} },
        bitrate: { total: 0, details: {} },
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
        releaseGroup: { total: 0, details: {} },
        size: { total: 0, details: {} },
        seeder: { total: 0, details: {} },
        age: { total: 0, details: {} },
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

  public generateFilterSummary(
    streams: ParsedStream[],
    finalStreams: ParsedStream[],
    type: string,
    id: string
  ): void {
    const totalFiltered = streams.length - finalStreams.length;
    const summary = [
      '\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      `  🔍 Filter Summary for ${id} (${type})`,
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
    logger.debug(summary.join('\n'));
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
    context: StreamContext
  ): Promise<ParsedStream[]> {
    const { type, id, parsedId, isAnime } = context;

    const start = Date.now();
    const isRegexAllowed = await FeatureControl.isRegexAllowed(this.userData, [
      ...(this.userData.excludedRegexPatterns ?? []),
      ...(this.userData.requiredRegexPatterns ?? []),
      ...(this.userData.includedRegexPatterns ?? []),
      ...(this.userData.preferredRegexPatterns ?? []).map(
        (regex) => regex.pattern
      ),
    ]);

    // Get metadata from context (already fetched in parallel with addon requests)
    const requestedMetadata: ExtendedMetadata | undefined =
      await context.getMetadata();
    const releaseDates: ReleaseDate[] | undefined =
      await context.getReleaseDates();
    const episodeAirDate: string | undefined =
      await context.getEpisodeAirDate();
    let originalLanguage = requestedMetadata?.originalLanguage
      ? iso6391ToLanguage(requestedMetadata.originalLanguage)
      : undefined;

    let yearWithinTitle: string | undefined;
    let yearWithinTitleRegex: RegExp | undefined;

    if (requestedMetadata?.title) {
      yearWithinTitle = requestedMetadata.title.match(
        /\b(19\d{2}|20[012]\d{1})\b/
      )?.[0];
      if (yearWithinTitle) {
        yearWithinTitleRegex = new RegExp(`${yearWithinTitle[0]}`, 'g');
      }
      logger.info(`Using metadata from context`, {
        id,
        title: requestedMetadata.title,
        year: requestedMetadata.year,
        hasGenres: !!requestedMetadata.genres?.length,
        originalLanguage: originalLanguage,
      });
    }

    // fill in bitrate from metadata runtime and size if missing and enabled
    if (this.userData.bitrate?.useMetadataRuntime !== false) {
      streams.forEach((stream) => {
        const isFolderSize =
          stream.parsedFile?.seasons?.length &&
          stream.parsedFile.seasons.length > 0 &&
          (!stream.parsedFile.episodes ||
            stream.parsedFile.episodes.length === 0);
        let doBitrateCalculation = true;

        if (
          (stream.bitrate === undefined || !Number.isFinite(stream.bitrate)) &&
          requestedMetadata?.runtime &&
          stream.size &&
          (!isFolderSize || type === 'series') // only calculate for folder sizes if it's a series
        ) {
          let episodeCount = stream.parsedFile?.episodes?.length || 0;
          let finalSize = stream.size;

          if (!stream.folderSize && episodeCount > 5 && type === 'series') {
            finalSize = stream.size / episodeCount;
            logger.silly(
              `Assuming episode pack for stream ${stream.filename} with ${episodeCount} episodes, dividing size by episode count for bitrate calculation`,
              {
                originalSize: formatBytes(stream.size, 1024),
                adjustedSize: formatBytes(finalSize, 1024),
              }
            );
          } else if (isFolderSize && type === 'series') {
            // For folder/season pack size, calculate per-episode size for bitrate calculation
            // Get total episodes across all seasons in the pack
            let totalEpisodes = 0;
            let hasUnknownSeasons = false;

            for (const season of stream.parsedFile?.seasons || []) {
              const seasonData = requestedMetadata.seasons?.find(
                (s) => s.season_number === season
              );

              if (seasonData?.episode_count) {
                totalEpisodes += seasonData.episode_count;
              } else {
                // If we can't find episode count for any season, we can't reliably calculate
                hasUnknownSeasons = true;
                break;
              }
            }

            if (!hasUnknownSeasons && totalEpisodes > 0) {
              logger.silly(
                `Calculating bitrate for season pack ${stream.filename} using total of ${totalEpisodes} episodes`,
                {
                  seasons: stream.parsedFile?.seasons,
                }
              );
              finalSize = finalSize / totalEpisodes;
            } else {
              doBitrateCalculation = false;
              logger.silly(
                `Cannot calculate bitrate for season pack ${stream.filename}: ${hasUnknownSeasons ? 'unknown season data' : 'no episodes found'}`,
                {
                  seasons: stream.parsedFile?.seasons,
                }
              );
            }
          }

          if (doBitrateCalculation) {
            stream.bitrate = Math.round(
              (finalSize * 8) / (requestedMetadata.runtime * 60)
            );
          }
        }
      });
    }

    const applyDigitalReleaseFilter = () => {
      const digitalReleaseFilterConfig = this.userData.digitalReleaseFilter;
      logger.debug(`[DigitalReleaseFilter] Checking filter for ${id}`, {
        enabled: digitalReleaseFilterConfig?.enabled,
        tolerance: digitalReleaseFilterConfig?.tolerance,
        requestTypes: digitalReleaseFilterConfig?.requestTypes,
        addons: digitalReleaseFilterConfig?.addons,
        contentType: type,
        releaseDate: requestedMetadata?.releaseDate,
        tmdbId: requestedMetadata?.tmdbId,
        releaseDatesCount: releaseDates?.length ?? 0,
      });
      if (!digitalReleaseFilterConfig?.enabled) {
        return true;
      }

      const filterRequestTypes = digitalReleaseFilterConfig.requestTypes;
      if (
        filterRequestTypes &&
        filterRequestTypes.length > 0 &&
        ((isAnime && !filterRequestTypes.includes('anime')) ||
          (!isAnime && !filterRequestTypes.includes(type)))
      ) {
        logger.debug(
          `[DigitalReleaseFilter] Skipping for type "${type}"${isAnime ? ' (anime)' : ''} (not in requestTypes: ${filterRequestTypes.join(', ')})`
        );
        return true;
      }

      if (!['movie', 'series', 'anime'].includes(type)) {
        logger.debug(
          `[DigitalReleaseFilter] Skipping for unsupported type "${type}"`
        );
        return true;
      }

      if (!requestedMetadata?.releaseDate) {
        logger.debug(
          `[DigitalReleaseFilter] No release date found, allowing streams`
        );
        return true;
      }

      const releaseDate = new Date(requestedMetadata.releaseDate);
      if (isNaN(releaseDate.getTime())) {
        logger.debug(
          `[DigitalReleaseFilter] Invalid release date "${requestedMetadata.releaseDate}", allowing streams`
        );
        return true;
      }
      const today = new Date();

      const daysSinceRelease = Math.floor(
        (today.getTime() - releaseDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      // Check tolerance: if release is within X days of current date, ignore filter
      const tolerance = digitalReleaseFilterConfig.tolerance ?? 0;
      const daysFromRelease = Math.abs(daysSinceRelease);

      if (daysFromRelease <= tolerance) {
        logger.debug(
          `[DigitalReleaseFilter] Within tolerance! ${daysFromRelease} days <= ${tolerance} days tolerance. ALLOWING streams.`,
          { title: requestedMetadata?.title, future: daysSinceRelease < 0 }
        );
        return true;
      }

      if (daysSinceRelease < 0) {
        logger.info(
          `[DigitalReleaseFilter] BLOCKING - Content releases in ${daysFromRelease} days (future release)`,
          { title: requestedMetadata?.title, type }
        );
        return false;
      }

      if (type === 'series' || type === 'anime') {
        // Use episode air date if we have it, else just use season releaseDate
        const dateToCheck = episodeAirDate || requestedMetadata?.releaseDate;

        if (!dateToCheck) {
          logger.debug(
            `[DigitalReleaseFilter] No episode or series air date found, allowing streams due to lack of data`
          );
          return true;
        }

        const episodeReleaseDate = new Date(dateToCheck);
        if (isNaN(episodeReleaseDate.getTime())) {
          logger.debug(
            `[DigitalReleaseFilter] Invalid episode/series date "${dateToCheck}", allowing streams`
          );
          return true;
        }

        const daysSinceEpisode = Math.floor(
          (today.getTime() - episodeReleaseDate.getTime()) /
            (1000 * 60 * 60 * 24)
        );

        logger.debug(
          `[DigitalReleaseFilter] Days since episode aired: ${daysSinceEpisode} (aired: ${dateToCheck})`
        );

        const daysFromAirDate = Math.abs(daysSinceEpisode);
        if (daysFromAirDate <= tolerance) {
          logger.debug(
            `[DigitalReleaseFilter] Episode within tolerance! ${daysFromAirDate} days <= ${tolerance} days tolerance. ALLOWING streams.`,
            {
              title: requestedMetadata?.title,
              episode: `${parsedId?.season}:${parsedId?.episode}`,
              future: daysSinceEpisode < 0,
            }
          );
          return true;
        }

        if (daysSinceEpisode < 0) {
          logger.info(
            `[DigitalReleaseFilter] BLOCKING - Episode airs in ${Math.abs(daysSinceEpisode)} days (future release)`,
            {
              title: requestedMetadata?.title,
              episode: `${parsedId?.season}:${parsedId?.episode}`,
            }
          );
          return false;
        }

        logger.debug(
          `[DigitalReleaseFilter] Episode has aired, allowing streams`
        );
        return true;
      }

      if (daysSinceRelease > 365) {
        logger.debug(
          `[DigitalReleaseFilter] Movie is over 1 year old, probably has digital release. Allowing streams.`
        );
        return true;
      }

      if (!releaseDates || releaseDates.length === 0) {
        logger.debug(
          `[DigitalReleaseFilter] No TMDB release dates found, allowing streams due to lack of data`
        );
        return true;
      }

      // check if at least one of the release dates is in the past and return true if so
      const digitalReleaseDates = releaseDates.filter(
        (rd) => rd.type >= 4 && rd.type <= 6
      );
      const hasDigitalRelease = digitalReleaseDates.some(
        (rd) => new Date(rd.release_date) <= today
      );

      logger.debug(
        `[DigitalReleaseFilter] Found ${digitalReleaseDates.length} digital release dates from TMDB`,
        {
          digitalReleaseDates: digitalReleaseDates.map((rd) => ({
            date: rd.release_date,
            type: rd.type,
          })),
          hasDigitalRelease,
        }
      );

      if (hasDigitalRelease) {
        logger.debug(
          `[DigitalReleaseFilter] Digital release found! Allowing streams.`
        );
        return true;
      }

      if (digitalReleaseDates.length > 0) {
        const closestDigitalRelease = digitalReleaseDates
          .map((rd) => {
            const releaseDate = new Date(rd.release_date);
            const daysUntilRelease = Math.ceil(
              (releaseDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
            );
            return { ...rd, daysUntilRelease };
          })
          .sort((a, b) => a.daysUntilRelease - b.daysUntilRelease)[0];

        if (
          closestDigitalRelease &&
          closestDigitalRelease.daysUntilRelease <= tolerance
        ) {
          logger.debug(
            `[DigitalReleaseFilter] Digital release within tolerance. ${closestDigitalRelease.daysUntilRelease} days until release <= ${tolerance} days tolerance. allowing streams.`,
            {
              title: requestedMetadata?.title,
              digitalReleaseDate: closestDigitalRelease.release_date,
            }
          );
          return true;
        }

        logger.info(
          `[DigitalReleaseFilter] BLOCKING - No digital release found for "${requestedMetadata?.title}"`,
          {
            daysSinceRelease,
            closestDigitalRelease: closestDigitalRelease?.release_date,
            daysUntilDigitalRelease: closestDigitalRelease?.daysUntilRelease,
          }
        );
        return false;
      }

      logger.info(
        `[DigitalReleaseFilter] BLOCKING - No digital release found for "${requestedMetadata?.title}"`,
        { daysSinceRelease }
      );
      return false;
    };

    const performTitleMatch = (stream: ParsedStream) => {
      const titleMatchingOptions = {
        mode: 'exact',
        similarityThreshold: 0.85,
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

      let streamTitle = stream.parsedFile?.title;
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

      if (!streamTitle || !stream.filename) {
        // only filter out movies without a year as series results usually don't include a year
        return false;
      }

      streamTitle = preprocessTitle(
        streamTitle,
        stream.filename,
        requestedMetadata.titles
      );

      if (titleMatchingOptions.mode === 'exact') {
        return titleMatch(
          normaliseTitle(streamTitle),
          requestedMetadata.titles.map(normaliseTitle),
          {
            threshold: titleMatchingOptions.similarityThreshold,
          }
        );
      } else {
        return titleMatch(
          normaliseTitle(streamTitle),
          requestedMetadata.titles.map(normaliseTitle),
          {
            threshold: titleMatchingOptions.similarityThreshold,
            scorer: partial_ratio,
          }
        );
      }
    };

    const findYearInString = (string: string) => {
      const regexes = [
        /[([*]?(?!^)(?<!\d|Cap[. ]?)((?:19\d{2}|20[012]\d{2}))(?!\d|kbps)[*)\]]?/i,
        /[([]?((?:19\d{2}|20[012]\d{1}))(?!\d|kbps)[)\]]?/i,
      ];
      for (const regex of regexes) {
        const match = string.match(regex);
        if (match && match[1]) {
          return match[1];
        }
      }
      return undefined;
    };

    const performYearMatch = (stream: ParsedStream) => {
      const yearMatchingOptions = {
        tolerance: 1,
        strict: true,
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

      let streamYear = stream.parsedFile?.year;
      if (yearWithinTitleRegex && yearWithinTitle) {
        const yearStr = yearWithinTitle;
        const filenameWithoutYear = stream.filename
          ? stream.filename.replace(yearWithinTitleRegex, '')
          : undefined;
        const foldernameWithoutYear = stream.folderName
          ? stream.folderName.replace(yearStr, '')
          : undefined;

        const strings = [filenameWithoutYear, foldernameWithoutYear].filter(
          (s): s is string => s !== undefined
        );

        for (const string of strings) {
          const newStreamYear = findYearInString(string);
          if (newStreamYear) {
            streamYear = newStreamYear;
            if (stream.parsedFile) {
              stream.parsedFile.year = newStreamYear;
            }
            break;
          }
        }
      }

      if (!streamYear) {
        // if no year is present, filter out if its a movie IF strict is true, keep otherwise
        return type === 'movie' && yearMatchingOptions.strict ? false : true;
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

      // if the requested content is a movie and season/episode is present, filter out
      if (
        type === 'movie' &&
        (stream.parsedFile?.seasons?.length ||
          stream.parsedFile?.episodes?.length)
      ) {
        return false;
      }
      let seasons = stream.parsedFile?.seasons;

      // if the requested content is series and no season or episode info is present, filter out if strict is true
      if (type === 'series' && seasonEpisodeMatchingOptions.strict) {
        if (
          !stream.parsedFile?.seasons?.length &&
          !stream.parsedFile?.episodes?.length
        ) {
          return false;
        }

        if (
          !stream.parsedFile.seasons?.length &&
          stream.parsedFile.episodes?.length
        ) {
          // assume season is 1 when empty and episode is present in strict mode.
          seasons = [1];
        }
      }

      if (
        requestedSeason &&
        seasons &&
        seasons.length > 0 &&
        !seasons.includes(requestedSeason)
      ) {
        if (
          seasons[0] === 1 &&
          stream.parsedFile?.episodes?.length &&
          requestedMetadata?.absoluteEpisode &&
          stream.parsedFile?.episodes?.includes(
            requestedMetadata.absoluteEpisode
          )
        ) {
          // allow if absolute episode matches AND season is 1
        } else if (
          seasons[0] === 1 &&
          stream.parsedFile?.episodes?.length &&
          requestedMetadata?.relativeAbsoluteEpisode &&
          stream.parsedFile?.episodes?.includes(
            requestedMetadata.relativeAbsoluteEpisode
          )
        ) {
          // allow if relative absolute episode (AniDB episode) matches AND season is 1
        } else {
          return false;
        }
      }

      if (
        requestedEpisode &&
        stream.parsedFile?.episodes?.length &&
        !stream.parsedFile?.episodes?.includes(requestedEpisode)
      ) {
        if (
          requestedMetadata?.absoluteEpisode &&
          stream.parsedFile?.episodes?.includes(
            requestedMetadata.absoluteEpisode
          ) &&
          (!seasons?.length || seasons[0] === 1)
        ) {
          // allow if absolute episode matches AND (no season OR season is 1)
        } else if (
          requestedMetadata?.relativeAbsoluteEpisode &&
          stream.parsedFile?.episodes?.includes(
            requestedMetadata.relativeAbsoluteEpisode
          ) &&
          (!seasons?.length || seasons[0] === 1)
        ) {
          // allow if relative absolute episode (AniDB episode) matches AND (no season OR season is 1)
        } else {
          return false;
        }
      }

      return true;
    };

    const includedStreamsByExpression =
      await this.applyIncludedStreamExpressions(streams, context);
    if (includedStreamsByExpression.length > 0) {
      logger.info(
        `${includedStreamsByExpression.length} streams were included by stream expressions`
      );
    }

    // Early digital release filter check - if it returns false, filter out streams
    // except those with passthrough for 'digitalRelease' stage or those from addons not in the filter list
    if (!applyDigitalReleaseFilter()) {
      const digitalReleaseFilterAddons =
        this.userData.digitalReleaseFilter?.addons;
      const passthroughDigitalRelease = streams.filter((stream) => {
        // Check if stream has passthrough for this stage
        if (shouldPassthroughStage(stream, 'digitalRelease')) {
          return true;
        }
        // If addons filter is set and stream is not from a filtered addon, bypass
        if (
          digitalReleaseFilterAddons &&
          digitalReleaseFilterAddons.length > 0 &&
          stream.addon.preset.id &&
          !digitalReleaseFilterAddons.includes(stream.addon.preset.id)
        ) {
          return true;
        }
        return false;
      });
      const filteredCount = streams.length - passthroughDigitalRelease.length;
      if (filteredCount > 0) {
        this.filterStatistics.removed.noDigitalRelease.total = filteredCount;
        this.filterStatistics.removed.noDigitalRelease.details[
          'No digital release available'
        ] = filteredCount;
      }
      if (passthroughDigitalRelease.length > 0) {
        this.incrementIncludedReason(
          'passthrough',
          `digitalRelease (${passthroughDigitalRelease.length})`
        );
      }

      if (passthroughDigitalRelease.length === 0) {
        const finalStreams: ParsedStream[] = [];
        logger.info(
          `Applied basic filters in ${getTimeTakenSincePoint(start)}`
        );
        return finalStreams;
      }
      // Continue with only passthrough streams
      streams = passthroughDigitalRelease;
    }

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

    const normaliseAgeRange = (ageRange: [number, number] | undefined) => {
      return normaliseRange(ageRange, {
        min: constants.MIN_AGE_HOURS,
        max: constants.MAX_AGE_HOURS,
      });
    };

    const normaliseSizeRange = (sizeRange: [number, number] | undefined) => {
      return normaliseRange(sizeRange, {
        min: constants.MIN_SIZE,
        max: constants.MAX_SIZE,
      });
    };

    const normaliseBitrateRange = (
      bitrateRange: [number, number] | undefined
    ) => {
      return normaliseRange(bitrateRange, {
        min: constants.MIN_BITRATE,
        max: constants.MAX_BITRATE,
      });
    };

    const getSeederStreamType = (
      stream: ParsedStream
    ): 'p2p' | 'cached' | 'uncached' | undefined => {
      switch (stream.type) {
        case 'debrid':
          return stream.service?.cached ? 'cached' : 'uncached';
        case 'p2p':
          return 'p2p';
        default:
          return undefined;
      }
    };

    const getAgeStreamType = (
      stream: ParsedStream
    ): 'debrid' | 'usenet' | 'p2p' | undefined => {
      switch (stream.type) {
        case 'debrid':
          return 'debrid';
        case 'usenet':
          return 'usenet';
        case 'p2p':
          return 'p2p';
        default:
          return undefined;
      }
    };

    const shouldKeepStream = async (stream: ParsedStream): Promise<boolean> => {
      const file = stream.parsedFile;

      const skipLanguageFiltering = shouldPassthroughStage(stream, 'language');

      if (originalLanguage && LANGUAGES.includes(originalLanguage as any)) {
        if (
          file?.languages &&
          file?.languages.length > 0 &&
          file?.languages.includes(originalLanguage)
        ) {
          file.languages.push('Original');
          file.languages.push(`Original-${originalLanguage}`);
        }
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

      if (shouldPassthroughStage(stream, 'filter')) {
        this.incrementIncludedReason('passthrough', stream.addon.name);
        return true;
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
        !skipLanguageFiltering &&
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
        this.userData.includedReleaseGroups?.some(
          (group) =>
            (file?.releaseGroup || 'Unknown').toLowerCase() ===
            group.toLowerCase()
        )
      ) {
        const group = this.userData.includedReleaseGroups.find(
          (group) =>
            (file?.releaseGroup || 'Unknown').toLowerCase() ===
            group.toLowerCase()
        );
        this.incrementIncludedReason('releaseGroup', group!);
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

      const includedAgeRange = normaliseAgeRange(this.userData.includeAgeRange);
      const excludedAgeRange = normaliseAgeRange(this.userData.excludeAgeRange);
      const requiredAgeRange = normaliseAgeRange(
        this.userData.requiredAgeRange
      );

      const typeForSeederRange = getSeederStreamType(stream);
      const typeForAgeRange = getAgeStreamType(stream);

      if (
        includedSeederRange &&
        (!this.userData.seederRangeTypes?.length ||
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

      if (
        includedAgeRange &&
        (!this.userData.ageRangeTypes?.length ||
          (typeForAgeRange &&
            this.userData.ageRangeTypes.includes(typeForAgeRange)))
      ) {
        if (includedAgeRange[0] && (stream.age ?? 0) > includedAgeRange[0]) {
          this.incrementIncludedReason('age', `>${includedAgeRange[0]}h`);
          return true;
        }
        if (includedAgeRange[1] && (stream.age ?? 0) < includedAgeRange[1]) {
          this.incrementIncludedReason('age', `<${includedAgeRange[1]}h`);
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
        !skipLanguageFiltering &&
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
        !skipLanguageFiltering &&
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

      // release group
      if (
        this.userData.excludedReleaseGroups?.some(
          (group) =>
            (file?.releaseGroup || 'Unknown').toLowerCase() ===
            group.toLowerCase()
        )
      ) {
        this.incrementRemovalReason(
          'excludedReleaseGroup',
          file?.releaseGroup || 'Unknown'
        );
        return false;
      }

      if (
        this.userData.requiredReleaseGroups &&
        this.userData.requiredReleaseGroups.length > 0 &&
        !this.userData.requiredReleaseGroups.some(
          (group) =>
            (file?.releaseGroup || 'Unknown').toLowerCase() ===
            group.toLowerCase()
        )
      ) {
        this.incrementRemovalReason(
          'requiredReleaseGroup',
          file?.releaseGroup || 'Unknown'
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
        this.userData.excludeSeasonPacks &&
        type === 'series' &&
        stream.parsedFile?.seasons?.length &&
        !stream.parsedFile?.episodes?.length
      ) {
        const seasons = stream.parsedFile?.seasons;
        const seasonStr =
          seasons?.length === 1
            ? `S${String(seasons[0]).padStart(2, '0')}`
            : seasons?.length
              ? `S${String(seasons[0]).padStart(2, '0')}-${String(seasons[seasons.length - 1]).padStart(2, '0')}`
              : undefined;
        this.incrementRemovalReason(
          'excludeSeasonPacks',
          `${stream.parsedFile.title} - ${seasonStr}`
        );
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
        (!this.userData.seederRangeTypes?.length ||
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
        (!this.userData.seederRangeTypes?.length ||
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

      if (
        requiredAgeRange &&
        (!this.userData.ageRangeTypes?.length ||
          (typeForAgeRange &&
            this.userData.ageRangeTypes.includes(typeForAgeRange)))
      ) {
        if (requiredAgeRange[0] && (stream.age ?? 0) < requiredAgeRange[0]) {
          this.incrementRemovalReason(
            'requiredAgeRange',
            `< ${requiredAgeRange[0]}h`
          );
          return false;
        }
        if (
          stream.age !== undefined &&
          requiredAgeRange[1] &&
          (stream.age ?? 0) > requiredAgeRange[1]
        ) {
          this.incrementRemovalReason(
            'requiredAgeRange',
            `> ${requiredAgeRange[1]}h`
          );
          return false;
        }
      }

      if (
        excludedAgeRange &&
        (!this.userData.ageRangeTypes?.length ||
          (typeForAgeRange &&
            this.userData.ageRangeTypes.includes(typeForAgeRange)))
      ) {
        if (excludedAgeRange[0] && (stream.age ?? 0) > excludedAgeRange[0]) {
          this.incrementRemovalReason(
            'excludedAgeRange',
            `< ${excludedAgeRange[0]}h`
          );
          return false;
        }
        if (excludedAgeRange[1] && (stream.age ?? 0) < excludedAgeRange[1]) {
          this.incrementRemovalReason(
            'excludedAgeRange',
            `> ${excludedAgeRange[1]}h`
          );
          return false;
        }
      }

      if (
        !shouldPassthroughStage(stream, 'title') &&
        !performTitleMatch(stream)
      ) {
        this.incrementRemovalReason(
          'titleMatching',
          `${stream.parsedFile?.title || 'Unknown Title'}${type === 'movie' ? ` - (${stream.parsedFile?.year || 'Unknown Year'})` : ''}`
        );
        return false;
      }

      if (
        !shouldPassthroughStage(stream, 'year') &&
        !performYearMatch(stream)
      ) {
        this.incrementRemovalReason(
          'yearMatching',
          `${stream.parsedFile?.title || 'Unknown Title'} - ${stream.parsedFile?.year || 'Unknown Year'}`
        );
        return false;
      }

      if (
        !shouldPassthroughStage(stream, 'episode') &&
        !performSeasonEpisodeMatch(stream)
      ) {
        const pad = (n: number) => n.toString().padStart(2, '0');
        const s = stream.parsedFile?.seasons;
        const e = stream.parsedFile?.episodes;
        const formattedSeasonString = s?.length
          ? `S${pad(s[0])}${s.length > 1 ? `-${pad(s[s.length - 1])}` : ''}`
          : undefined;
        const formattedEpisodeString = e?.length
          ? `E${pad(e[0])}${e.length > 1 ? `-${pad(e[e.length - 1])}` : ''}`
          : undefined;
        const seasonEpisode = [
          formattedSeasonString,
          formattedEpisodeString,
        ].filter(Boolean);
        const detail =
          stream.parsedFile?.title +
          ' ' +
          (seasonEpisode?.join(' • ') || 'Unknown');

        this.incrementRemovalReason('seasonEpisodeMatching', detail);
        return false;
      }

      const globalSizeRange = this.userData.size?.global;
      const resolutionSizeRange = stream.parsedFile?.resolution
        ? // @ts-ignore
          this.userData.size?.resolution?.[stream.parsedFile.resolution]
        : undefined;

      let finalSizeRange: [number | undefined, number | undefined] | undefined;
      if (type === 'movie') {
        finalSizeRange =
          normaliseSizeRange(resolutionSizeRange?.movies) ||
          normaliseSizeRange(globalSizeRange?.movies);
      } else {
        finalSizeRange =
          (isAnime
            ? normaliseSizeRange(resolutionSizeRange?.anime) ||
              normaliseSizeRange(globalSizeRange?.anime)
            : undefined) ||
          normaliseSizeRange(resolutionSizeRange?.series) ||
          normaliseSizeRange(globalSizeRange?.series);
      }

      if (finalSizeRange) {
        if (
          stream.size &&
          finalSizeRange[0] &&
          stream.size < finalSizeRange[0]
        ) {
          this.incrementRemovalReason(
            'size',
            `< ${formatBytes(finalSizeRange[0], 1000)}`
          );
          return false;
        }
        if (
          stream.size &&
          finalSizeRange[1] &&
          stream.size > finalSizeRange[1]
        ) {
          this.incrementRemovalReason(
            'size',
            `> ${formatBytes(finalSizeRange[1], 1000)}`
          );
          return false;
        }
      }

      const globalBitrateRange = this.userData.bitrate?.global;
      const resolutionBitrateRange = stream.parsedFile?.resolution
        ? // @ts-ignore
          this.userData.bitrate?.resolution?.[stream.parsedFile.resolution]
        : undefined;

      let finalBitrateRange:
        | [number | undefined, number | undefined]
        | undefined;
      if (type === 'movie') {
        finalBitrateRange =
          normaliseBitrateRange(resolutionBitrateRange?.movies) ||
          normaliseBitrateRange(globalBitrateRange?.movies);
      } else {
        finalBitrateRange =
          (isAnime
            ? normaliseBitrateRange(resolutionBitrateRange?.anime) ||
              normaliseBitrateRange(globalBitrateRange?.anime)
            : undefined) ||
          normaliseBitrateRange(resolutionBitrateRange?.series) ||
          normaliseBitrateRange(globalBitrateRange?.series);
      }

      if (
        finalBitrateRange &&
        stream.bitrate !== undefined &&
        Number.isFinite(stream.bitrate)
      ) {
        if (
          finalBitrateRange[0] !== undefined &&
          stream.bitrate < finalBitrateRange[0]
        ) {
          this.incrementRemovalReason(
            'bitrate',
            `< ${formatBitrate(finalBitrateRange[0])}`
          );
          return false;
        }
        if (
          finalBitrateRange[1] !== undefined &&
          stream.bitrate > finalBitrateRange[1]
        ) {
          this.incrementRemovalReason(
            'bitrate',
            `> ${formatBitrate(finalBitrateRange[1])}`
          );
          return false;
        }
      }

      return true;
    };

    // Separate included streams by whether they have passthrough flags
    const includedWithPassthrough = includedStreamsByExpression.filter(
      (stream) => stream.passthrough !== undefined
    );
    const includedWithoutPassthrough = includedStreamsByExpression.filter(
      (stream) => stream.passthrough === undefined
    );

    if (includedWithoutPassthrough.length > 0) {
      logger.info(
        `${includedWithoutPassthrough.length} included streams (no passthrough) will skip filtering entirely`
      );
    }

    if (includedWithPassthrough.length > 0) {
      logger.info(
        `${includedWithPassthrough.length} included streams have passthrough flags and will go through filtering`
      );

      for (const stream of includedWithPassthrough) {
        const stages = Array.isArray(stream.passthrough)
          ? stream.passthrough.join(', ')
          : 'all';
        logger.debug(
          `Stream "${stream.filename || stream.id}" passthrough stages: [${stages}]`
        );
      }
    }

    // Only exclude streams without passthrough from filtering
    const filterableStreams = streams.filter(
      (stream) => !includedWithoutPassthrough.some((s) => s.id === stream.id)
    );

    const filterResults = await Promise.all(
      filterableStreams.map(shouldKeepStream)
    );

    let filteredStreams = filterableStreams.filter(
      (_, index) => filterResults[index]
    );

    const finalStreams = StreamUtils.mergeStreams([
      ...includedWithoutPassthrough,
      ...filteredStreams,
    ]);

    logger.info(
      `Applied basic filters in ${getTimeTakenSincePoint(start)}, removed ${streams.length - finalStreams.length} streams`
    );
    return finalStreams;
  }
  private truncateCondition(condition: string): string {
    const maxLength = 50;
    if (condition.length > maxLength) {
      return condition.substring(0, maxLength - 3) + '...';
    }
    return condition;
  }

  public async applyIncludedStreamExpressions(
    streams: ParsedStream[],
    context: StreamContext
  ): Promise<ParsedStream[]> {
    const expressionContext = context.toExpressionContext();
    const selector = new StreamSelector(expressionContext);
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
      const displayCondition = this.truncateCondition(expression);
      this.filterStatistics.included.streamExpression.details[
        displayCondition
      ] =
        (this.filterStatistics.included.streamExpression.details[
          displayCondition
        ] || 0) + selectedStreams.length;
      selectedStreams.forEach((stream) => streamsToKeep.add(stream.id));
    }
    return streams.filter((stream) => streamsToKeep.has(stream.id));
  }

  public async applyStreamExpressionFilters(
    streams: ParsedStream[],
    context: StreamContext
  ): Promise<ParsedStream[]> {
    const expressionContext = context.toExpressionContext();

    // Get streams that passthrough excluded SEL
    const excludedPassthroughStreams = streams
      .filter((stream) => shouldPassthroughStage(stream, 'excluded'))
      .map((stream) => stream.id);

    // Get streams that passthrough required SEL
    const requiredPassthroughStreams = streams
      .filter((stream) => shouldPassthroughStage(stream, 'required'))
      .map((stream) => stream.id);

    if (
      this.userData.excludedStreamExpressions &&
      this.userData.excludedStreamExpressions.length > 0
    ) {
      const selector = new StreamSelector(expressionContext);
      const streamsToRemove = new Set<string>(); // Track actual stream objects to be removed

      for (const expression of this.userData.excludedStreamExpressions) {
        try {
          // Always select from the current filteredStreams (not yet modified by this loop)
          const selectedStreams = await selector.select(
            streams.filter((stream) => !streamsToRemove.has(stream.id)),
            expression
          );

          // Track these stream objects for removal (except passthrough streams)
          selectedStreams.forEach(
            (stream) =>
              !excludedPassthroughStreams.includes(stream.id) &&
              streamsToRemove.add(stream.id)
          );

          // Update skip reasons for this condition (only count newly selected streams)
          if (selectedStreams.length > 0) {
            this.filterStatistics.removed.excludedFilterCondition.total +=
              selectedStreams.length;
            const displayCondition = this.truncateCondition(expression);
            this.filterStatistics.removed.excludedFilterCondition.details[
              displayCondition
            ] =
              (this.filterStatistics.removed.excludedFilterCondition.details[
                displayCondition
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
      const selector = new StreamSelector(expressionContext);
      const streamsToKeep = new Set<string>(); // Track actual stream objects to be removed
      requiredPassthroughStreams.forEach((stream) => streamsToKeep.add(stream));

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
            const displayCondition = this.truncateCondition(expression);
            this.filterStatistics.removed.requiredFilterCondition.details[
              displayCondition
            ] =
              (this.filterStatistics.removed.requiredFilterCondition.details[
                displayCondition
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
        `Total streams selected by required conditions: ${streamsToKeep.size} (including ${requiredPassthroughStreams.length} passthrough streams)`
      );
      // remove all streams that are not in the streamsToKeep set
      streams = streams.filter((stream) => streamsToKeep.has(stream.id));
    }
    return streams;
  }
}

export default StreamFilterer;
