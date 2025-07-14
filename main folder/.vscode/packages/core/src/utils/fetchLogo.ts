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
    let imdbId: string | undefined = undefined;
    let tvdbId: string | undefined = undefined;
    let endpointType: 'movie' | 'tv' | 'collection';
    // Determine endpointType and ids
    if (type === 'collection') {
      endpointType = 'collection';
      // Always extract numeric TMDB ID for collections
      if (id.startsWith('tmdb:') || id.startsWith('tmdb-')) {
        tmdbId = id.replace(/^tmdb[:\-]/, '');
      } else {
        tmdbId = id;
      }
      tmdbId = tmdbId.replace(/[^0-9]/g, '');
    } else {
      endpointType = type === 'movie' ? 'movie' : 'tv';
      // Try to extract all possible IDs
      if (id.startsWith('imdb:') || id.startsWith('tt')) {
        imdbId = id.replace(/^imdb:/, '').replace(/^tt/, 'tt');
      } else if (id.startsWith('tmdb:') || id.startsWith('tmdb-')) {
        tmdbId = id.replace(/^tmdb[:\-]/, '');
      } else if (id.startsWith('tvdb:') || id.startsWith('tvdb-')) {
        tvdbId = id.replace(/^tvdb[:\-]/, '');
      } else {
        tmdbId = id;
      }
      // If we don't have imdbId, try to fetch it from TMDB
      if (!imdbId && tmdbId) {
        try {
          const url = `https://api.themoviedb.org/3/${endpointType}/${tmdbId}/external_ids`;
          const res = await fetch(url, {
            headers: { Authorization: `Bearer ${Env.TMDB_ACCESS_TOKEN}` },
            signal: AbortSignal.timeout(7000),
          });
          if (res.ok) {
            const data = await res.json();
            if (data.imdb_id) imdbId = data.imdb_id;
            if (data.tvdb_id) tvdbId = data.tvdb_id?.toString();
          }
        } catch (e) {}
      }
    }

    // Debug log
    // eslint-disable-next-line no-console
    if (type === 'collection') {
      console.log(`[fetchLogoForItem][COLLECTION] id=${id} tmdbId=${tmdbId}`);
    } else {
      console.log(`[fetchLogoForItem] type=${type} tmdbId=${tmdbId} imdbId=${imdbId} tvdbId=${tvdbId}`);
    }

    // Try fanart.tv first for all types
    let fanartUrl = '';
    if (type === 'collection' && tmdbId) {
      fanartUrl = `https://webservice.fanart.tv/v3/collections/${tmdbId}?api_key=${Env.FANART_API_KEY || '6e0b6b6e7c1b9b6e7b6e7b6e'}`;
    } else if (type === 'movie' && imdbId) {
      fanartUrl = `https://webservice.fanart.tv/v3/movies/${imdbId}?api_key=${Env.FANART_API_KEY || '6e0b6b6e7c1b9b6e7b6e7b6e'}`;
    } else if ((type === 'series' || type === 'tv') && (tvdbId || tmdbId)) {
      if (tvdbId) {
        fanartUrl = `https://webservice.fanart.tv/v3/tv/${tvdbId}?api_key=${Env.FANART_API_KEY || '6e0b6b6e7c1b9b6e7b6e7b6e'}`;
      } else if (tmdbId) {
        fanartUrl = `https://webservice.fanart.tv/v3/tv/${tmdbId}?api_key=${Env.FANART_API_KEY || '6e0b6b6e7c1b9b6e7b6e7b6e'}`;
      }
    } else if (type === 'movie' && tmdbId) {
      // fallback to tmdb id for movies
      fanartUrl = `https://webservice.fanart.tv/v3/movies/${tmdbId}?api_key=${Env.FANART_API_KEY || '6e0b6b6e7c1b9b6e7b6e7b6e'}`;
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
            // Extra debug for collections
            console.log('[fetchLogoForItem][COLLECTION] fanartData:', JSON.stringify(fanartData));
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

    // Special fallback for collections: try to use the logo of the latest movie in the collection
    if (type === 'collection' && tmdbId) {
      try {
        // Get collection details from TMDB to find the latest movie
        const collectionUrl = `https://api.themoviedb.org/3/collection/${tmdbId}`;
        const collectionRes = await fetch(collectionUrl, {
          headers: { Authorization: `Bearer ${Env.TMDB_ACCESS_TOKEN}` },
          signal: AbortSignal.timeout(7000),
        });
        
        if (collectionRes.ok) {
          const collectionData = await collectionRes.json();
          if (collectionData.parts && Array.isArray(collectionData.parts) && collectionData.parts.length > 0) {
            // Sort by release date to get the latest movie
            const sortedParts = collectionData.parts
              .filter((part: any) => part.release_date)
              .sort((a: any, b: any) => new Date(b.release_date).getTime() - new Date(a.release_date).getTime());
            
            if (sortedParts.length > 0) {
              const latestMovie = sortedParts[0];
              console.log(`[fetchLogoForItem][COLLECTION] Trying latest movie fallback: ${latestMovie.title} (${latestMovie.id})`);
              
              // Try to get logo for the latest movie using fanart.tv
              const movieFanartUrl = `https://webservice.fanart.tv/v3/movies/${latestMovie.id}?api_key=${Env.FANART_API_KEY || '6e0b6b6e7c1b9b6e7b6e7b6e'}`;
              const movieFanartRes = await fetch(movieFanartUrl, { signal: AbortSignal.timeout(7000) });
              
              if (movieFanartRes.ok) {
                const movieFanartData = await movieFanartRes.json();
                
                // Helper to pick logo by language priority
                function pickLogo(arr: any[]): any | null {
                  if (!Array.isArray(arr) || arr.length === 0) return null;
                  return (
                    arr.find((l: any) => l.lang === 'tr') ||
                    arr.find((l: any) => l.lang === 'en') ||
                    arr[0]
                  );
                }
                
                // Try hdmovielogo first, then movielogo
                if (movieFanartData.hdmovielogo && Array.isArray(movieFanartData.hdmovielogo) && movieFanartData.hdmovielogo.length > 0) {
                  const logo = pickLogo(movieFanartData.hdmovielogo);
                  if (logo && logo.url) {
                    console.log(`[fetchLogoForItem][COLLECTION] Found logo from latest movie hdmovielogo: ${logo.url}`);
                    return logo.url;
                  }
                }
                if (movieFanartData.movielogo && Array.isArray(movieFanartData.movielogo) && movieFanartData.movielogo.length > 0) {
                  const logo = pickLogo(movieFanartData.movielogo);
                  if (logo && logo.url) {
                    console.log(`[fetchLogoForItem][COLLECTION] Found logo from latest movie movielogo: ${logo.url}`);
                    return logo.url;
                  }
                }
              }
            }
          }
        }
      } catch (e) {
        console.log(`[fetchLogoForItem][COLLECTION] Error in latest movie fallback: ${e}`);
        // Continue to regular TMDB fallback
      }
    }

    // Fallback to TMDB
    if (!tmdbId) {
      if (type === 'collection') {
        // Force fallback logo for collections if no TMDB id
        return 'https://static.strem.io/catimg/collection-default.png';
      }
      return null;
    }
    const url = `https://api.themoviedb.org/3/${endpointType}/${tmdbId}/images`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${Env.TMDB_ACCESS_TOKEN}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      if (type === 'collection') {
        // Force fallback logo for collections if TMDB fails
        return 'https://static.strem.io/catimg/collection-default.png';
      }
      return null;
    }
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
    if (type === 'collection') {
      // Final fallback for collections
      return 'https://static.strem.io/catimg/collection-default.png';
    }
    return null;
  } catch (e) {
    return null;
  }
}
