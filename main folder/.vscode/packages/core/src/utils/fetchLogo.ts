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
    let endpointType: 'movie' | 'tv' | 'collection';
    // Determine endpointType and tmdbId
    if (type === 'collection') {
      endpointType = 'collection';
    } else if (type === 'movie') {
      endpointType = 'movie';
    } else {
      endpointType = 'tv';
    }
    if (id.startsWith('tmdb:') || id.startsWith('tmdb-')) {
      tmdbId = id.replace(/^tmdb[:\-]/, '');
    } else {
      tmdbId = id;
    }

    // Try fanart.tv first for all types
    if (tmdbId) {
      let fanartUrl = '';
      if (type === 'collection') {
        fanartUrl = `https://webservice.fanart.tv/v3/collections/${tmdbId}?api_key=${Env.FANART_API_KEY || '6e0b6b6e7c1b9b6e7b6e7b6e'}`;
      } else if (type === 'movie') {
        fanartUrl = `https://webservice.fanart.tv/v3/movies/${tmdbId}?api_key=${Env.FANART_API_KEY || '6e0b6b6e7c1b9b6e7b6e7b6e'}`;
      } else if (type === 'series' || type === 'tv') {
        fanartUrl = `https://webservice.fanart.tv/v3/tv/${tmdbId}?api_key=${Env.FANART_API_KEY || '6e0b6b6e7c1b9b6e7b6e7b6e'}`;
      }
      if (fanartUrl) {
        try {
          const fanartRes = await fetch(fanartUrl, { signal: AbortSignal.timeout(7000) });
          if (fanartRes.ok) {
            const fanartData = await fanartRes.json();
            // Helper to pick logo by language priority
            function pickLogo(arr: any[]): any | null {
              if (!Array.isArray(arr) || arr.length === 0) return null;
              return (
                arr.find((l: any) => l.lang === 'tr') ||
                arr.find((l: any) => l.lang === 'en') ||
                arr[0]
              );
            }
            // Collections: hdmovielogo, movielogo
            if (type === 'collection') {
              if (fanartData.hdmovielogo && Array.isArray(fanartData.hdmovielogo) && fanartData.hdmovielogo.length > 0) {
                const logo = pickLogo(fanartData.hdmovielogo);
                if (logo && logo.url) return logo.url;
              }
              if (fanartData.movielogo && Array.isArray(fanartData.movielogo) && fanartData.movielogo.length > 0) {
                const logo = pickLogo(fanartData.movielogo);
                if (logo && logo.url) return logo.url;
              }
            }
            // Movies: hdmovielogo, movielogo
            if (type === 'movie') {
              if (fanartData.hdmovielogo && Array.isArray(fanartData.hdmovielogo) && fanartData.hdmovielogo.length > 0) {
                const logo = pickLogo(fanartData.hdmovielogo);
                if (logo && logo.url) return logo.url;
              }
              if (fanartData.movielogo && Array.isArray(fanartData.movielogo) && fanartData.movielogo.length > 0) {
                const logo = pickLogo(fanartData.movielogo);
                if (logo && logo.url) return logo.url;
              }
            }
            // TV: hdtvlogo, clearlogo
            if (type === 'series' || type === 'tv') {
              if (fanartData.hdtvlogo && Array.isArray(fanartData.hdtvlogo) && fanartData.hdtvlogo.length > 0) {
                const logo = pickLogo(fanartData.hdtvlogo);
                if (logo && logo.url) return logo.url;
              }
              if (fanartData.clearlogo && Array.isArray(fanartData.clearlogo) && fanartData.clearlogo.length > 0) {
                const logo = pickLogo(fanartData.clearlogo);
                if (logo && logo.url) return logo.url;
              }
            }
          }
        } catch (e) {
          // Ignore fanart.tv errors, fallback to TMDB
        }
      }
    }

    // Fallback to TMDB
    if (!tmdbId) return null;
    const url = `https://api.themoviedb.org/3/${endpointType}/${tmdbId}/images`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${Env.TMDB_ACCESS_TOKEN}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return null;
    const data: LogoApiResponse = await response.json();
    if (data.logos && Array.isArray(data.logos) && data.logos.length > 0) {
      // Prioritize Turkish, then English, then any
      const logo = data.logos.find((l) => l.iso_639_1 === 'tr') ||
        data.logos.find((l) => l.iso_639_1 === 'en') ||
        data.logos[0];
      if (logo && logo.file_path) {
        return `https://image.tmdb.org/t/p/original${logo.file_path}`;
      }
    }
    return null;
  } catch (e) {
    return null;
  }
}
