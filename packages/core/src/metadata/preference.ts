import { MetadataProviderPreference } from '../db/schemas.js';
import { MediaType, MetadataSource } from './merge.js';

export function resolvePreferredSources(
  metadataProvider: MetadataProviderPreference | undefined,
  mediaType: MediaType,
  isAnime: boolean
): MetadataSource[] {
  const bucket = isAnime
    ? 'anime'
    : mediaType === 'movie'
      ? 'movies'
      : 'series';
  const choice =
    metadataProvider?.[bucket] ?? metadataProvider?.global ?? 'default';
  switch (choice) {
    case 'tmdb':
      return ['tmdb'];
    case 'tvdb':
      return ['tvdb'];
    case 'imdb':
      return ['cinemeta', 'imdbSuggestion'];
    default:
      return [];
  }
}
