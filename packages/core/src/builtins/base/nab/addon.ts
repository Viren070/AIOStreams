import { z } from 'zod';
import { ParsedId } from '../../../utils/id-parser.js';
import { Env, getTimeTakenSincePoint } from '../../../utils/index.js';
import { Logger } from 'winston';
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
import { createQueryLimit, useAllTitles } from '../../utils/general.js';

export const NabAddonConfigSchema = BaseDebridConfigSchema.extend({
  url: z.string(),
  apiKey: z.string().optional(),
  apiPath: z.string().optional(),
  forceQuerySearch: z.boolean().default(false),
  paginate: z.boolean().default(false),
  forceInitialLimit: z.number().optional(),
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
    let searchType: SearchResultMetadata['searchType'] = 'id';
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

    queryParams.limit =
      this.userData.forceInitialLimit?.toString() ??
      capabilities.limits?.max?.toString() ??
      '10000';

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

    if (
      ((!this.userData.forceQuerySearch &&
        searchCapabilities.supportedParams.includes('season')) ||
        forceIncludeSeasonEpInParams.includes(
          capabilities.server.title || ''
        )) &&
      parsedId.season
    )
      queryParams.season = parsedId.season.toString();
    if (
      ((!this.userData.forceQuerySearch &&
        searchCapabilities.supportedParams.includes('ep')) ||
        forceIncludeSeasonEpInParams.includes(
          capabilities.server.title || ''
        )) &&
      parsedId.episode
    )
      queryParams.ep = parsedId.episode.toString();
    if (
      !this.userData.forceQuerySearch &&
      searchCapabilities.supportedParams.includes('year') &&
      metadata.year &&
      parsedId.mediaType === 'movie'
    )
      queryParams.year = metadata.year.toString();

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
        useAllTitles: useAllTitles(this.userData.url),
      });
      searchType = 'query';
    }
    queryParams.extended = '1';
    let results: SearchResultItem<A['namespace']>[] = [];
    if (queries.length > 0) {
      this.logger.debug('Performing queries', { queries });
      const searchPromises = queries.map((q) =>
        queryLimit(() =>
          this.fetchResults(searchFunction, { ...queryParams, q })
        )
      );
      const allResults = await Promise.all(searchPromises);
      results = allResults.flat();
    } else {
      results = await this.fetchResults(searchFunction, queryParams);
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
    const maxPages = Env.BUILTIN_NAB_MAX_PAGES;

    const initialResponse: SearchResponse<A['namespace']> =
      await this.api.search(searchFunction, params);
    let allResults = [...initialResponse.results];

    this.logger.debug('Initial search response', {
      resultsCount: initialResponse.results.length,
      offset: initialResponse.offset,
      total: initialResponse.total,
    });

    // if both first and last items are duplicates, the page is likely a duplicate
    const areResultsDuplicate = (
      existing: SearchResultItem<A['namespace']>[],
      newResults: SearchResultItem<A['namespace']>[]
    ): boolean => {
      if (newResults.length === 0) return false;

      const firstNew = newResults[0];
      const lastNew = newResults[newResults.length - 1];

      const firstExists = existing.some((r) => r.guid === firstNew.guid);
      const lastExists = existing.some((r) => r.guid === lastNew.guid);

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
