import { ParsedStream, SortCriterion, UserData } from '../db/schemas';
import { createLogger, getTimeTakenSincePoint } from '../utils';
import { VISUAL_TAGS } from '../utils/constants';
import { AUDIO_TAGS } from '../utils/constants';

const logger = createLogger('sorter');

class StreamSorter {
  private userData: UserData;

  constructor(userData: UserData) {
    this.userData = userData;
  }

  public async sort(
    streams: ParsedStream[],
    type: string
  ): Promise<ParsedStream[]> {
    let primarySortCriteria = this.userData.sortCriteria.global;
    let cachedSortCriteria = this.userData.sortCriteria.cached;
    let uncachedSortCriteria = this.userData.sortCriteria.uncached;

    const start = Date.now();

    if (type === 'movie') {
      if (this.userData.sortCriteria?.movies?.length) {
        primarySortCriteria = this.userData.sortCriteria?.movies;
      }
      if (this.userData.sortCriteria?.cachedMovies?.length) {
        cachedSortCriteria = this.userData.sortCriteria?.cachedMovies;
      }
      if (this.userData.sortCriteria?.uncachedMovies?.length) {
        uncachedSortCriteria = this.userData.sortCriteria?.uncachedMovies;
      }
    }

    if (type === 'series') {
      if (this.userData.sortCriteria?.series?.length) {
        primarySortCriteria = this.userData.sortCriteria?.series;
      }
      if (this.userData.sortCriteria?.cachedSeries?.length) {
        cachedSortCriteria = this.userData.sortCriteria?.cachedSeries;
      }
      if (this.userData.sortCriteria?.uncachedSeries?.length) {
        uncachedSortCriteria = this.userData.sortCriteria?.uncachedSeries;
      }
    }

    if (type === 'anime') {
      if (this.userData.sortCriteria?.anime?.length) {
        primarySortCriteria = this.userData.sortCriteria?.anime;
      }
      if (this.userData.sortCriteria?.cachedAnime?.length) {
        cachedSortCriteria = this.userData.sortCriteria?.cachedAnime;
      }
      if (this.userData.sortCriteria?.uncachedAnime?.length) {
        uncachedSortCriteria = this.userData.sortCriteria?.uncachedAnime;
      }
    }

    let sortedStreams = [];

    if (
      cachedSortCriteria?.length &&
      uncachedSortCriteria?.length &&
      primarySortCriteria.length > 0 &&
      primarySortCriteria[0].key === 'cached'
    ) {
      logger.info(
        'Splitting streams into cached and uncached and using separate sort criteria'
      );
      const cachedStreams = streams.filter(
        (stream) => stream.service?.cached || stream.service === undefined // streams without a service can be considered as 'cached'
      );
      const uncachedStreams = streams.filter(
        (stream) => stream.service?.cached === false
      );

      // sort the 2 lists separately, and put them after the other, depending on the direction of cached
      const cachedSorted = cachedStreams.slice().sort((a, b) => {
        const aKey = this.dynamicSortKey(a, cachedSortCriteria, type);
        const bKey = this.dynamicSortKey(b, cachedSortCriteria, type);
        for (let i = 0; i < aKey.length; i++) {
          if (aKey[i] < bKey[i]) return -1;
          if (aKey[i] > bKey[i]) return 1;
        }
        return 0;
      });

      const uncachedSorted = uncachedStreams.slice().sort((a, b) => {
        const aKey = this.dynamicSortKey(a, uncachedSortCriteria, type);
        const bKey = this.dynamicSortKey(b, uncachedSortCriteria, type);
        for (let i = 0; i < aKey.length; i++) {
          if (aKey[i] < bKey[i]) return -1;
          if (aKey[i] > bKey[i]) return 1;
        }
        return 0;
      });

      if (primarySortCriteria[0].direction === 'desc') {
        sortedStreams = [...cachedSorted, ...uncachedSorted];
      } else {
        sortedStreams = [...uncachedSorted, ...cachedSorted];
      }
    } else {
      logger.debug(
        `using sort criteria: ${JSON.stringify(primarySortCriteria)}`
      );
      sortedStreams = streams.slice().sort((a, b) => {
        const aKey = this.dynamicSortKey(a, primarySortCriteria, type);
        const bKey = this.dynamicSortKey(b, primarySortCriteria, type);

        for (let i = 0; i < aKey.length; i++) {
          if (aKey[i] < bKey[i]) return -1;
          if (aKey[i] > bKey[i]) return 1;
        }
        return 0;
      });
    }

    logger.info(
      `Sorted ${sortedStreams.length} streams in ${getTimeTakenSincePoint(start)}`
    );
    return sortedStreams;
  }

  private dynamicSortKey(
    stream: ParsedStream,
    sortCriteria: SortCriterion[],
    type: string
  ): any[] {
    function keyValue(sortCriterion: SortCriterion, userData: UserData) {
      const { key, direction } = sortCriterion;
      const multiplier = direction === 'asc' ? 1 : -1;
      switch (key) {
        case 'cached':
          return multiplier * (stream.service?.cached !== false ? 1 : 0);

        case 'library':
          return multiplier * (stream.library ? 1 : 0);
        case 'size':
          return multiplier * (stream.size ?? 0);
        case 'seeders':
          return multiplier * (stream.torrent?.seeders ?? 0);
        case 'encode': {
          if (!userData.preferredEncodes) {
            return 0;
          }

          const index = userData.preferredEncodes?.findIndex(
            (encode) => encode === (stream.parsedFile?.encode || 'Unknown')
          );
          return multiplier * -(index === -1 ? Infinity : index);
        }
        case 'addon':
          // find the first occurence of the stream.addon.id in the addons array
          if (!userData.presets) {
            return 0;
          }

          const idx = userData.presets.findIndex(
            (p) => p.instanceId === stream.addon.presetInstanceId
          );
          return multiplier * -(idx === -1 ? Infinity : idx);

        case 'resolution': {
          if (!userData.preferredResolutions) {
            return 0;
          }

          const index = userData.preferredResolutions?.findIndex(
            (resolution) =>
              resolution === (stream.parsedFile?.resolution || 'Unknown')
          );
          return multiplier * -(index === -1 ? Infinity : index);
        }
        case 'quality': {
          if (!userData.preferredQualities) {
            return 0;
          }

          const index = userData.preferredQualities.findIndex(
            (quality) => quality === (stream.parsedFile?.quality || 'Unknown')
          );
          return multiplier * -(index === -1 ? Infinity : index);
        }
        case 'visualTag': {
          if (!userData.preferredVisualTags) {
            return 0;
          }

          const effectiveVisualTags = stream.parsedFile?.visualTags.length
            ? stream.parsedFile.visualTags
            : ['Unknown'];

          if (
            effectiveVisualTags.every(
              (tag) => !userData.preferredVisualTags!.includes(tag as any)
            )
          ) {
            return multiplier * -Infinity;
          }

          let minIndex = userData.preferredVisualTags?.length;

          for (const tag of effectiveVisualTags) {
            if (VISUAL_TAGS.includes(tag as any)) {
              const idx = userData.preferredVisualTags?.indexOf(tag as any);
              if (idx !== undefined && idx !== -1 && idx < minIndex) {
                minIndex = idx;
              }
            }
          }
          return multiplier * -minIndex;
        }
        case 'audioTag': {
          if (!userData.preferredAudioTags) {
            return 0;
          }

          const effectiveAudioTags = stream.parsedFile?.audioTags.length
            ? stream.parsedFile.audioTags
            : ['Unknown'];

          if (
            effectiveAudioTags.every(
              (tag) => !userData.preferredAudioTags!.includes(tag as any)
            )
          ) {
            return multiplier * -Infinity;
          }
          let minAudioIndex = userData.preferredAudioTags.length;

          for (const tag of effectiveAudioTags) {
            if (AUDIO_TAGS.includes(tag as any)) {
              const idx = userData.preferredAudioTags?.indexOf(tag as any);
              if (idx !== undefined && idx !== -1 && idx < minAudioIndex) {
                minAudioIndex = idx;
              }
            }
          }
          return multiplier * -minAudioIndex;
        }
        case 'streamType': {
          if (!userData.preferredStreamTypes) {
            return 0;
          }
          const index = userData.preferredStreamTypes?.findIndex(
            (type) => type === stream.type
          );
          return multiplier * -(index === -1 ? Infinity : index);
        }
        case 'language': {
          let minLanguageIndex = userData.preferredLanguages?.length;
          if (minLanguageIndex === undefined) {
            return 0;
          }
          for (const language of stream.parsedFile?.languages || ['Unknown']) {
            const idx = userData.preferredLanguages?.indexOf(language as any);
            if (idx !== undefined && idx !== -1 && idx < minLanguageIndex) {
              minLanguageIndex = idx;
            }
          }
          return multiplier * -minLanguageIndex;
        }
        case 'regexPatterns':
          return (
            multiplier *
            -(stream.regexMatched ? stream.regexMatched.index : Infinity)
          );
        case 'streamExpressionMatched':
          return multiplier * -(stream.streamExpressionMatched ?? Infinity);
        case 'keyword':
          return multiplier * (stream.keywordMatched ? 1 : 0);

        case 'service': {
          if (!userData.services) {
            return 0;
          }

          const index = userData.services.findIndex(
            (service) => service.id === stream.service?.id
          );
          return multiplier * -(index === -1 ? Infinity : index);
        }
        default:
          return 0;
      }
    }

    return (
      sortCriteria.map((sortCriterion) =>
        keyValue(sortCriterion, this.userData)
      ) ?? []
    );
  }
}

export default StreamSorter;
