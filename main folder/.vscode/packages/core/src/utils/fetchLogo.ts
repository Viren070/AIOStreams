// Utility to fetch a logo URL for a given TMDB or IMDB id and type (movie/series)
import { TMDBMetadata } from './metadata';
import { Env } from '../utils/env';
import { IdConverter } from './idConverter';
import { FanartTvApi } from './fanartTv';

type LogoImage = {
  file_path: string;
  iso_639_1?: string;
};

type LogoApiResponse = {
  logos: LogoImage[];
};

export async function fetchLogoForItem(id: string, type: string): Promise<string | null> {
  try {
    console.log(`[fetchLogoForItem] Starting for id: ${id}, type: ${type}`);
    
    const parsedId = IdConverter.parseId(id);
    let tmdbId: string | undefined;
    let endpointType: 'movie' | 'tv' | 'collection';
    
    // Determine endpoint type and get TMDB ID
    if (type === 'collection') {
      endpointType = 'collection';
      tmdbId = parsedId.type === 'tmdb' ? parsedId.id : id.replace(/[^0-9]/g, '');
    } else {
      endpointType = type === 'movie' ? 'movie' : 'tv';
      
      if (parsedId.type === 'tmdb') {
        tmdbId = parsedId.id;
      } else if (parsedId.type === 'imdb') {
        // Convert IMDB to TMDB
        const conversionResult = await IdConverter.imdbToTmdb(parsedId.id);
        if (conversionResult) {
          tmdbId = conversionResult.tmdbId;
          endpointType = conversionResult.type;
        }
      } else {
        // Assume it's a TMDB ID
        tmdbId = parsedId.id;
      }
    }

    if (!tmdbId) {
      console.log(`[fetchLogoForItem] No TMDB ID found for ${id}`);
      return null;
    }

    // Try Fanart.tv first for better quality logos
    let logoUrl: string | null = null;
    
    if (type === 'collection') {
      logoUrl = await FanartTvApi.getCollectionLogo(tmdbId);
    } else if (type === 'movie') {
      logoUrl = await FanartTvApi.getMovieLogo(tmdbId);
    } else if (type === 'series' || type === 'tv') {
      logoUrl = await FanartTvApi.getTvLogo(tmdbId);
    }

    if (logoUrl) {
      console.log(`[fetchLogoForItem] Found Fanart.tv logo for ${id}: ${logoUrl}`);
      return logoUrl;
    }

    // Fallback to TMDB images
    console.log(`[fetchLogoForItem] No Fanart.tv logo found, trying TMDB images for ${id}`);
    
    const url = `https://api.themoviedb.org/3/${endpointType}/${tmdbId}/images`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${Env.TMDB_ACCESS_TOKEN}` },
      signal: AbortSignal.timeout(10000),
    });
    
    if (!response.ok) {
      console.log(`[fetchLogoForItem] TMDB images request failed: ${response.status}`);
      return null;
    }
    
    const data: LogoApiResponse = await response.json();
    if (data.logos && Array.isArray(data.logos) && data.logos.length > 0) {
      // Prioritize Turkish, then English, then any
      const logo = data.logos.find((l) => l.iso_639_1 === 'tr') ||
        data.logos.find((l) => l.iso_639_1 === 'en') ||
        data.logos[0];
      
      if (logo && logo.file_path) {
        const tmdbLogoUrl = `https://image.tmdb.org/t/p/original${logo.file_path}`;
        console.log(`[fetchLogoForItem] Found TMDB logo for ${id}: ${tmdbLogoUrl}`);
        return tmdbLogoUrl;
      }
    }

    console.log(`[fetchLogoForItem] No logo found for ${id}`);
    return null;
  } catch (e) {
    console.error(`[fetchLogoForItem] Error: ${e}`);
    return null;
  }
}
