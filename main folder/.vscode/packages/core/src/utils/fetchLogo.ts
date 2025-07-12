// Utility to fetch a logo URL for a given TMDB or IMDB id and type (movie/series)
import { TMDBMetadata } from './metadata';
import { Env } from '../utils/env';

type LogoImage = {
  file_path: string;
  iso_639_1?: string;
};

type LogoApiResponse = {
  logos: LogoImage[];
};

export async function fetchLogoForItem(id: string, type: string): Promise<string | null> {
  try {
    const tmdb = new TMDBMetadata();
    let tmdbId: string | undefined = undefined;
    let endpointType = '';
    if (type === 'collection') {
      // TMDB collections endpoint
      endpointType = 'collection';
      if (id.startsWith('tmdb:') || id.startsWith('tmdb-')) {
        tmdbId = id.replace(/^tmdb[:\-]/, '');
      } else {
        tmdbId = id;
      }
    } else {
      // movie or series
      endpointType = type === 'movie' ? 'movie' : 'tv';
      const meta = await tmdb.getMetadata(id, endpointType);
      if (id.startsWith('tmdb:') || id.startsWith('tmdb-')) {
        tmdbId = id.replace(/^tmdb[:\-]/, '');
      } else if (meta && meta.titles && meta.titles.length > 0) {
        tmdbId = id;
      }
    }
    if (!tmdbId) return null;
    const url = `https://api.themoviedb.org/3/${endpointType}/${tmdbId}/images`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${Env.TMDB_ACCESS_TOKEN}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return null;
    const data: LogoApiResponse = await response.json();
    if (data.logos && Array.isArray(data.logos) && data.logos.length > 0) {
      const logo = data.logos.find((l) => l.iso_639_1 === 'en') || data.logos[0];
      if (logo && logo.file_path) {
        return `https://image.tmdb.org/t/p/original${logo.file_path}`;
      }
    }
    return null;
  } catch (e) {
    return null;
  }
}
