export { BasePosterService } from './base.js';
export type { ParsedPosterId } from './base.js';
export { RPDB } from './rpdb.js';
export { TopPoster } from './topPoster.js';
export { AIOratings } from './aioratings.js';
export { OpenPosterDB } from './openposterdb.js';

import type { BasePosterService } from './base.js';
import { RPDB } from './rpdb.js';
import { TopPoster } from './topPoster.js';
import { AIOratings } from './aioratings.js';
import { OpenPosterDB } from './openposterdb.js';
import type { UserData } from '../db/schemas.js';

export type PosterServiceType =
  | 'rpdb'
  | 'top-poster'
  | 'aioratings'
  | 'openposterdb'
  | 'none';

/**
 * All known poster service domains. Used to check if a poster URL
 * is already from a poster service.
 *
 * OpenPosterDB is excluded because its domain is user-configurable;
 * its instance `ownDomains` handles this at runtime.
 */
export const ALL_POSTER_SERVICE_DOMAINS = [
  'api.ratingposterdb.com',
  'api.top-posters.com',
  'apiv2.aioratings.com',
];

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
    case 'openposterdb':
      return userData.openposterdbApiKey
        ? new OpenPosterDB(
            userData.openposterdbApiKey,
            userData.openposterdbUrl
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
    case 'openposterdb':
      return new OpenPosterDB(apiKey, params.baseUrl);
    default:
      return null;
  }
}
