import { z } from 'zod';
import { ParsedId } from '../../../utils/id-parser.js';
import { getTimeTakenSincePoint } from '../../../utils/index.js';
import { Logger } from 'winston';
import {
  BaseDebridAddon,
  BaseDebridConfigSchema,
  SearchMetadata,
} from '../debrid.js';
import { BaseNabApi, Capabilities, SearchResultItem } from './api.js';

export const NabAddonConfigSchema = BaseDebridConfigSchema.extend({
  url: z.string(),
  apiKey: z.string().optional(),
  apiPath: z.string().optional(),
  forceQuerySearch: z.boolean().default(false),
});
export type NabAddonConfig = z.infer<typeof NabAddonConfigSchema>;

export abstract class BaseNabAddon<
  C extends NabAddonConfig,
  A extends BaseNabApi<'torznab' | 'newznab'>,
> extends BaseDebridAddon<C> {
  abstract api: A;

  protected async performSearch(
    parsedId: ParsedId,
    metadata: SearchMetadata
  ): Promise<SearchResultItem<A['namespace']>[]> {
    const start = Date.now();
    const queryParams: Record<string, string> = {};
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

    queryParams.limit = capabilities.limits?.max?.toString() ?? '10000';

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
      !this.userData.forceQuerySearch &&
      searchCapabilities.supportedParams.includes('season') &&
      parsedId.season
    )
      queryParams.season = parsedId.season.toString();
    if (
      !this.userData.forceQuerySearch &&
      searchCapabilities.supportedParams.includes('ep') &&
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
      queries.push(metadata.primaryTitle);
      if (
        parsedId.season &&
        parsedId.episode &&
        !queryParams.season &&
        !queryParams.ep
      ) {
        queries = [
          `${metadata.primaryTitle} S${parsedId.season.toString().padStart(2, '0')}`,
          `${metadata.primaryTitle} S${parsedId.season.toString().padStart(2, '0')}E${parsedId.episode.toString().padStart(2, '0')}`,
        ];
        if (metadata.absoluteEpisode)
          queries.push(
            `${metadata.primaryTitle} ${metadata.absoluteEpisode.toString().padStart(2, '0')}`
          );
      }
      if (
        metadata.year &&
        parsedId.mediaType === 'movie' &&
        !queryParams.year
      ) {
        queries = queries.map((q) => `${q} ${metadata.year}`);
      }
    }
    let results: SearchResultItem<A['namespace']>[] = [];
    if (queries.length > 0) {
      this.logger.debug('Performing queries', { queries });
      const searchPromises = queries.map((q) =>
        this.api.search(searchFunction, { ...queryParams, q })
      );
      const allResults = await Promise.all(searchPromises);
      results = allResults.flat() as SearchResultItem<A['namespace']>[];
    } else {
      results = (await this.api.search(
        searchFunction,
        queryParams
      )) as unknown as SearchResultItem<A['namespace']>[];
    }
    this.logger.info(
      `Completed search for ${capabilities.server.title} in ${getTimeTakenSincePoint(start)}`,
      {
        results: results.length,
      }
    );
    return results;
  }

  private getSearchFunction(
    type: string,
    searching: Capabilities['searching']
  ) {
    const available = Object.keys(searching);
    this.logger.debug(
      `Available search functions: ${JSON.stringify(available)}`
    );
    if (type === 'movie') {
      const movieSearch = available.find((s) =>
        s.toLowerCase().includes('movie')
      );
      if (movieSearch && (searching as any)[movieSearch].available)
        return {
          capabilities: (searching as any)[movieSearch],
          function: 'movie',
        };
    } else {
      const tvSearch = available.find((s) => s.toLowerCase().includes('tv'));
      if (tvSearch && (searching as any)[tvSearch].available)
        return {
          capabilities: (searching as any)[tvSearch],
          function: 'tvsearch',
        };
    }
    if ((searching as any).search.available)
      return { capabilities: (searching as any).search, function: 'search' };
    return undefined;
  }
}
