export { BasePosterService } from './base.js';
export type { ParsedPosterId } from './base.js';
export { RPDB } from './rpdb.js';
export { TopPoster } from './topPoster.js';
export { AIOratings } from './aioratings.js';

import type { BasePosterService } from './base.js';
import { RPDB } from './rpdb.js';
import { TopPoster } from './topPoster.js';
import { AIOratings } from './aioratings.js';
import type { UserData } from '../db/schemas.js';

export type PosterServiceType = 'rpdb' | 'top-poster' | 'aioratings' | 'none';

/**
 * All known poster service domains. Used to check if a poster URL
 * is already from a poster service.
 */
export const ALL_POSTER_SERVICE_DOMAINS = [
  'api.ratingposterdb.com',
  'api.top-streaming.stream',
  'apiv2.aioratings.com',
];

/**
 * Check whether a poster URL is already from any poster service.
 */
export function isPosterFromAnyService(posterUrl: string): boolean {
  return ALL_POSTER_SERVICE_DOMAINS.some((d) => posterUrl.includes(d));
}

/**
 * Create a poster service instance from user data, or return null if
 * the service is 'none' or no API key is configured.
 */
export function createPosterService(
  userData: UserData
): BasePosterService | null {
  const posterService =
    userData.posterService || (userData.rpdbApiKey ? 'rpdb' : undefined);

  switch (posterService) {
    case 'rpdb':
      return userData.rpdbApiKey ? new RPDB(userData.rpdbApiKey) : null;
    case 'top-poster':
      return userData.topPosterApiKey
        ? new TopPoster(userData.topPosterApiKey)
        : null;
    case 'aioratings':
      return userData.aioratingsApiKey
        ? new AIOratings(
            userData.aioratingsApiKey,
            userData.aioratingsProfileId || 'default'
          )
        : null;
    default:
      return null;
  }
}

/**
 * Given a service type string, create the poster service instance
 * from just an API key + optional params. Used by the server route.
 */
export function createPosterServiceFromParams(
  service: string,
  apiKey: string,
  params: Record<string, string> = {}
): BasePosterService | null {
  switch (service) {
    case 'rpdb':
      return new RPDB(apiKey);
    case 'top-poster':
      return new TopPoster(apiKey);
    case 'aioratings':
      return new AIOratings(apiKey, params.profileId || 'default');
    default:
      return null;
  }
}
