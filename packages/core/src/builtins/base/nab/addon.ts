import { z } from 'zod';
import { ParsedId } from '../../../utils/id-parser.js';
import {
  getTimeTakenSincePoint,
  normaliseLanguage,
  normaliseParsedMediaInfo,
  ParsedMediaInfo,
} from '../../../utils/index.js';
import { config as appConfig } from '../../../config/index.js';
import {
  BaseDebridAddon,
  BaseDebridConfigSchema,
  SearchMetadata,
} from '../debrid.js';
import {
  BaseNabApi,
  Capabilities,
  SearchResponse,
  SearchResultItem,
} from './api.js';
import {
  createQueryLimit,
  getTitleLanguagesForUrl,
  titleContainsAirDate,
} from '../../utils/general.js';
import type { ReleaseIds } from '../../../db/schemas.js';
import type { NabAttrs } from './scan.js';
import { ReleaseYearSchema } from '../../../db/schemas.js';
import { parseIndexerAudioTracks } from '../../../utils/media-info.js';

/** The item's content year, never pubDate/usenetdate or the search query's year. */
export function parseNabReleaseYear(attrs: NabAttrs): string | undefined {
  const raw = attrs.year;
  if (raw === undefined || raw === '') return undefined;
  const values = String(raw)
    .split(',')
    .map((value) => value.trim());
  if (values.some((value) => !ReleaseYearSchema.safeParse(value).success))
    return undefined;
  return new Set(values).size === 1 ? values[0] : undefined;
}

/** Only numeric item categories leave the adapter. */
export function nabCategoryIds(attrs: NabAttrs): number[] {
  return [
    ...new Set(
      String(attrs.category ?? '')
        .split(',')
        .filter((value) => /^\d+$/.test(value.trim()))
        .map(Number)
        .filter((value) => Number.isSafeInteger(value) && value > 0)
    ),
  ];
}

/** Standard TV/Anime category on this item; generic TV/HD/SD categories say nothing about animation. */
export function parseNabReleaseMedium(
  attrs: NabAttrs
): 'animation' | undefined {
  return nabCategoryIds(attrs).includes(5070) ? 'animation' : undefined;
}

/** Preserve item IDs; never derive them from query parameters or title text. */
export function parseNabReleaseIds(attrs: NabAttrs): ReleaseIds | undefined {
  const ids: ReleaseIds = {};
  for (const [key, aliases] of [
    ['imdbId', ['imdb', 'imdbid']],
    ['tvdbId', ['tvdbid']],
  ] as const) {
    const values = new Set<string>();
    for (const alias of aliases) {
      const raw = attrs[alias];
      if (raw === undefined || raw === '') continue;
      for (const value of String(raw).split(',')) {
        const trimmed = value.trim();
        const digits = key === 'imdbId' ? trimmed.replace(/^tt/i, '') : trimmed;
        if (/^0+$/.test(digits) || !digits) continue;
        if (!/^\d+$/.test(digits) || !Number.isSafeInteger(Number(digits)))
          return undefined;
        if (key === 'imdbId' && digits.length > 10) return undefined;
        values.add(
          key === 'imdbId'
            ? `tt${digits.padStart(7, '0')}`
            : String(Number(digits))
        );
      }
    }
    // Conflicting repeated IDs or aliases make the whole record unreliable.
    if (values.size > 1) return undefined;
    const value = [...values][0];
    if (value) {
      if (key === 'imdbId') ids.imdbId = value;
      else ids.tvdbId = Number(value);
    }
  }
  // A bare TMDB number has separate movie and TV namespaces; do not guess one.
  return ids.imdbId || ids.tvdbId ? ids : undefined;
}

/**
 * Parse a comma-separated language string from a newznab/torznab attribute
 * into an array of canonical AIOStreams language names.
 */
export function parseNabLanguages(
  value: string | number | boolean | undefined
): string[] {
  if (typeof value !== 'string' || !value) return [];

  const seen = new Set<string>();
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
    .map((v) => normaliseLanguage(v))
    .filter((v): v is string => !!v)
    .filter((v) => {
      if (seen.has(v)) return false;
      seen.add(v);
      return true;
    });
}

export function parseNabParsedFileInfo(args: {
  audioLanguages?: string | number | boolean;
  subtitleLanguages?: string | number | boolean;
  audioTracks?: string | number | boolean;
}): ParsedMediaInfo | undefined {
  const tracks = parseIndexerAudioTracks(args.audioTracks);
  return normaliseParsedMediaInfo({
    ...tracks,
    mediaInfoQuality: 'indexer',
    languages: [
      ...new Set([
        ...parseNabLanguages(args.audioLanguages),
        ...(tracks?.languages ?? []),
      ]),
    ],
    subtitles: parseNabLanguages(args.subtitleLanguages),
  });
}

export const NabAddonConfigSchema = BaseDebridConfigSchema.extend({
  url: z.string(),
  apiKey: z.string().optional(),
  apiPath: z.string().optional(),
  forceQuerySearch: z.boolean().default(false),
  paginate: z.boolean().default(false),
  forceInitialLimit: z.number().min(1).max(10000).optional(),
  seasonEpisodeStrategy: z
    .enum(['episode', 'season', 'episodeFirst', 'dynamic'])
    .default('episode'),
});
export type NabAddonConfig = z.infer<typeof NabAddonConfigSchema>;

interface SearchResultMetadata {
  searchType: 'id' | 'query';
  capabilities: Capabilities;
}

export abstract class BaseNabAddon<
  C extends NabAddonConfig,
  A extends BaseNabApi<'torznab' | 'newznab'>,
> extends BaseDebridAddon<C> {
  abstract api: A;

  protected async performSearch(
    parsedId: ParsedId,
    metadata: SearchMetadata
  ): Promise<{
    results: SearchResultItem<A['namespace']>[];
    meta: SearchResultMetadata;
  }> {
    const forceIncludeSeasonEpInParams = ['StremThru'];
    const start = Date.now();
    const queryParams: Record<string, string> = {};
    const queryLimit = createQueryLimit();
    let capabilities: Capabilities;
    try {
      capabilities = await this.api.getCapabilities();
    } catch (error) {
      throw new Error(
        `Could not get capabilities: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    this.logger.debug(`Capabilities: ${JSON.stringify(capabilities)}`);

    const chosenFunction = this.getSearchFunction(
      parsedId.mediaType,
      capabilities.searching
    );
    if (!chosenFunction)
      throw new Error(
        `Could not find a search function for ${capabilities.server.title}`
      );

    const { capabilities: searchCapabilities, function: searchFunction } =
      chosenFunction;
    this.logger.debug(`Using search function: ${searchFunction}`, {
      searchCapabilities,
    });

    queryParams.limit = String(
      Math.min(
        this.userData.forceInitialLimit ?? capabilities.limits?.max ?? 10000,
        appConfig.builtins.nab.maxResults
      )
    );

    if (this.userData.forceQuerySearch) {
    } else if (
      // prefer tvdb ID over imdb ID for series
      parsedId.mediaType === 'series' &&
      searchCapabilities.supportedParams.includes('tvdbid') &&
      metadata.tvdbId
    ) {
      queryParams.tvdbid = metadata.tvdbId.toString();
    } else if (
      searchCapabilities.supportedParams.includes('imdbid') &&
      metadata.imdbId
    )
      queryParams.imdbid = metadata.imdbId.replace('tt', '');
    else if (
      searchCapabilities.supportedParams.includes('tmdbid') &&
      metadata.tmdbId
    )
      queryParams.tmdbid = metadata.tmdbId.toString();
    else if (
      searchCapabilities.supportedParams.includes('tvdbid') &&
      metadata.tvdbId
    )
      queryParams.tvdbid = metadata.tvdbId.toString();

    // a tvdb id search is answered in tvdb's own numbering
    const searchSeason =
      (queryParams.tvdbid && metadata.tvdbSeason) || parsedId.season;
    const searchEpisode =
      (queryParams.tvdbid && metadata.tvdbEpisode) || parsedId.episode;
    if (
      ((!this.userData.forceQuerySearch &&
        searchCapabilities.supportedParams.includes('season')) ||
        forceIncludeSeasonEpInParams.includes(
          capabilities.server.title || ''
        )) &&
      searchSeason
    )
      queryParams.season = searchSeason.toString();
    if (
      ((!this.userData.forceQuerySearch &&
        searchCapabilities.supportedParams.includes('ep')) ||
        forceIncludeSeasonEpInParams.includes(
          capabilities.server.title || ''
        )) &&
      searchEpisode
    )
      queryParams.ep = searchEpisode.toString();
    if (
      !this.userData.forceQuerySearch &&
      searchCapabilities.supportedParams.includes('year') &&
      metadata.year &&
      parsedId.mediaType === 'movie'
    )
      queryParams.year = metadata.year.toString();

    // date-based shows: numeric season/ep params return nothing, the Sonarr
    // daily convention (season=YYYY&ep=MM/DD) is what indexers understand
    const isDailySearch =
      parsedId.mediaType === 'series' &&
      metadata.isDateBased &&
      metadata.episodeAirDate &&
      queryParams.season !== undefined &&
      queryParams.ep !== undefined;
    // preserve the numeric season/ep so we can fall back to them if the daily
    // search misses
    let numericFallbackParams: Record<string, string> | undefined;
    if (isDailySearch) {
      // queryParams still holds the numeric season/ep here
      numericFallbackParams = { ...queryParams };
      const [yyyy, mm, dd] = metadata.episodeAirDate!.split('-');
      queryParams.season = yyyy;
      queryParams.ep = `${mm}/${dd}`;
    }

    queryParams.extended = '1';

    const canApplySeasonPackStrategy =
      parsedId.mediaType === 'series' &&
      !this.userData.forceQuerySearch &&
      !isDailySearch &&
      searchCapabilities.supportedParams.includes('season') &&
      queryParams.season &&
      queryParams.ep;

    let primaryParams = queryParams;
    let fallbackParams: Record<string, string> | undefined;
    if (canApplySeasonPackStrategy) {
      const { ep, ...seasonOnlyParams } = queryParams;
      let strategy = this.userData.seasonEpisodeStrategy;
      if (strategy === 'dynamic') {
        strategy = metadata.ongoingSeason ? 'episode' : 'season';
      }
      if (strategy === 'season') {
        primaryParams = seasonOnlyParams;
      } else if (strategy === 'episodeFirst') {
        fallbackParams = seasonOnlyParams;
      }
    }

    const searchType: SearchResultMetadata['searchType'] =
      queryParams.imdbid || queryParams.tmdbid || queryParams.tvdbid
        ? 'id'
        : 'query';
    let queries: string[] = [];
    if (
      !queryParams.imdbid &&
      !queryParams.tmdbid &&
      !queryParams.tvdbid &&
      searchCapabilities.supportedParams.includes('q') &&
      metadata.primaryTitle
    ) {
      queries = this.buildQueries(parsedId, metadata, {
        // add year if it is not already in the query params
        addYear: !queryParams.year,
        // add season and episode if they are not already in the query params
        // some endpoints won't return results with season/ep in query
        addSeasonEpisode: forceIncludeSeasonEpInParams.includes(
          capabilities.server.title || ''
        )
          ? false
          : !queryParams.season && !queryParams.ep,
        titleLanguages: getTitleLanguagesForUrl(this.userData.url, this.id),
      });
    }
    let results: SearchResultItem<A['namespace']>[] = [];
    if (queries.length > 0) {
      const runQueries = (params: Record<string, string>) => {
        this.logger.debug('Performing queries', { queries });
        return Promise.all(
          queries.map((q) =>
            queryLimit(() =>
              this.fetchResults(searchFunction, { ...params, q })
            )
          )
        ).then((allResults) => allResults.flat());
      };

      results = await runQueries(primaryParams);
      if (results.length === 0 && fallbackParams) {
        this.logger.debug(
          'No results for initial queries, retrying with alternate season/episode params',
          { season: queryParams.season, episode: queryParams.ep }
        );
        results = await runQueries(fallbackParams);
      }
    } else {
      results = await this.fetchResults(searchFunction, primaryParams);
      if (results.length === 0 && fallbackParams) {
        this.logger.debug(
          'No results for initial search, retrying with alternate season/episode params',
          { season: queryParams.season, episode: queryParams.ep }
        );
        results = await this.fetchResults(searchFunction, fallbackParams);
      }
      if (
        isDailySearch &&
        numericFallbackParams &&
        !results.some((r) =>
          titleContainsAirDate(r.title, metadata.airDates ?? [])
        )
      ) {
        this.logger.debug(
          'No air-date match for daily search, retrying with numeric season/episode params',
          {
            airDate: metadata.episodeAirDate,
            season: numericFallbackParams.season,
            episode: numericFallbackParams.ep,
          }
        );
        results = await this.fetchResults(
          searchFunction,
          numericFallbackParams
        );
      }
    }
    this.logger.info(
      `Completed search for ${capabilities.server.title} in ${getTimeTakenSincePoint(start)}`,
      {
        results: results.length,
      }
    );
    return {
      results: results,
      meta: {
        searchType,
        capabilities,
      },
    };
  }

  private getSearchFunction(
    type: string,
    searching: Capabilities['searching']
  ) {
    const available = Object.keys(searching);
    this.logger.debug(
      `Available search functions: ${JSON.stringify(available)}`
    );
    if (this.userData.forceQuerySearch) {
      // dont use specific search functions when force query search is enabled
    } else if (type === 'movie') {
      const movieSearch = available.find((s) =>
        s.toLowerCase().includes('movie')
      );
      if (movieSearch && searching[movieSearch].available)
        return {
          capabilities: searching[movieSearch],
          function: 'movie',
        };
    } else {
      const tvSearch = available.find((s) => s.toLowerCase().includes('tv'));
      if (tvSearch && searching[tvSearch].available)
        return {
          capabilities: (searching as any)[tvSearch],
          function: 'tvsearch',
        };
    }
    if ((searching as any).search.available)
      return { capabilities: (searching as any).search, function: 'search' };
    return undefined;
  }

  private async fetchResults(
    searchFunction: string,
    params: Record<string, string>
  ): Promise<SearchResultItem<A['namespace']>[]> {
    const queryLimit = createQueryLimit();
    const maxPages = appConfig.builtins.nab.maxPages;

    const initialResponse: SearchResponse<A['namespace']> =
      await this.api.search(searchFunction, params);
    let allResults = [...initialResponse.results];

    this.logger.debug('Initial search response', {
      resultsCount: initialResponse.results.length,
      offset: initialResponse.offset,
      total: initialResponse.total,
    });

    const identity = (r: SearchResultItem<A['namespace']>): string =>
      r.guid ?? r.enclosure?.[0]?.url ?? r.title;

    // if both first and last items are duplicates, the page is likely a duplicate
    const areResultsDuplicate = (
      existing: SearchResultItem<A['namespace']>[],
      newResults: SearchResultItem<A['namespace']>[]
    ): boolean => {
      if (newResults.length === 0) return false;

      const firstNew = identity(newResults[0]);
      const lastNew = identity(newResults[newResults.length - 1]);

      const firstExists = existing.some((r) => identity(r) === firstNew);
      const lastExists = existing.some((r) => identity(r) === lastNew);

      return firstExists && lastExists;
    };

    if (!this.userData.paginate) {
      this.logger.info(
        'Pagination handling is disabled, returning initial results only'
      );
      return allResults;
    }

    if (initialResponse.total !== undefined && initialResponse.total > 0) {
      const limit =
        initialResponse.results.length > 0
          ? initialResponse.results.length
          : parseInt(params.limit || '100', 10);
      const total = initialResponse.total;
      const initialOffset = initialResponse.offset || 0;

      // Calculate how many more pages we need
      const remainingResults = total - (initialOffset + limit);
      if (remainingResults > 0) {
        const additionalPages = Math.ceil(remainingResults / limit);
        const pagesToFetch = Math.min(additionalPages, maxPages - 1); // -1 because we already fetched first page

        if (pagesToFetch > 0) {
          this.logger.debug('Fetching additional pages with known total', {
            total,
            limit,
            pagesToFetch,
            remainingResults,
          });

          // Create requests for all remaining pages in parallel
          const pagePromises = Array.from({ length: pagesToFetch }, (_, i) => {
            const offset = initialOffset + limit * (i + 1);
            return queryLimit(
              () =>
                this.api.search(searchFunction, {
                  ...params,
                  offset: offset.toString(),
                }) as Promise<SearchResponse<A['namespace']>>
            );
          });

          const pageResponses = await Promise.all(pagePromises);
          for (const response of pageResponses) {
            if (areResultsDuplicate(allResults, response.results)) {
              this.logger.warn(
                'Detected duplicate results in paginated response. Indexer may not support offset parameter despite claiming support. Stopping pagination.'
              );
              break;
            }
            allResults.push(...response.results);
          }
        }
      }
    } else {
      // keep fetching until we get empty results or hit max pages
      let pageCount = 1;
      let currentOffset =
        (initialResponse.offset || 0) + initialResponse.results.length;
      const limit =
        initialResponse.results.length > 0
          ? initialResponse.results.length
          : parseInt(params.limit || '100', 10);

      this.logger.debug('Fetching pages without known total', {
        initialResultsCount: initialResponse.results.length,
        limit,
      });

      while (pageCount < maxPages) {
        const response: SearchResponse<A['namespace']> = await this.api.search(
          searchFunction,
          {
            ...params,
            offset: currentOffset.toString(),
          }
        );

        if (response.results.length === 0) {
          this.logger.debug('Received empty page, stopping pagination');
          break;
        }

        if (areResultsDuplicate(allResults, response.results)) {
          this.logger.warn(
            'Detected duplicate results in paginated response. Indexer may not support offset parameter. Stopping pagination.'
          );
          break;
        }

        allResults.push(...response.results);
        currentOffset += response.results.length;
        pageCount++;

        this.logger.debug('Fetched additional page', {
          pageCount,
          resultsInPage: response.results.length,
          totalResults: allResults.length,
        });

        // if this page returned less results than the limit, we can assume there are no more pages
        if (response.results.length < limit) {
          this.logger.debug(
            'Received less results than limit, assuming last page'
          );
          break;
        }
      }

      if (pageCount >= maxPages) {
        this.logger.warn(
          `Reached maximum page limit (${maxPages}), stopping pagination`
        );
      }
    }

    this.logger.info('Completed fetching all results', {
      totalResults: allResults.length,
    });

    return allResults;
  }
}
