import { Env } from './env';
import { IdConverter } from './idConverter';

/**
 * Enhanced Fanart.tv API integration for fetching logos and artwork
 */
export class FanartTvApi {
  private static readonly BASE_URL = 'https://webservice.fanart.tv/v3';
  private static readonly TIMEOUT = 7000;
  private static logoCache = new Map<string, { url: string | null, timestamp: number }>();
  private static readonly CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

  /**
   * Pick the best logo from available options based on language preference
   * @param logos - Array of logo objects
   * @param language - Preferred language (e.g., 'en-US')
   * @param originalLanguage - Original language of the content
   * @returns Best logo object or null
   */
  private static pickLogo(logos: any[], language: string = 'en-US', originalLanguage?: string): any | null {
    if (!Array.isArray(logos) || logos.length === 0) return null;

    const lang = language.split('-')[0]; // Get language code without region
    
    return (
      logos.find(l => l.lang === lang) ||
      logos.find(l => l.lang === originalLanguage) ||
      logos.find(l => l.lang === 'en') ||
      logos[0]
    );
  }

  /**
   * Get movie logo from Fanart.tv
   * @param tmdbId - TMDB ID of the movie
   * @param language - Language preference
   * @param originalLanguage - Original language of the movie
   * @returns Promise<string | null> - Logo URL or null
   */
  static async getMovieLogo(tmdbId: string, language: string = 'en-US', originalLanguage?: string): Promise<string | null> {
    if (!Env.FANART_API_KEY || !tmdbId) {
      return null;
    }

    const cacheKey = `movie_${tmdbId}_${language}`;
    const cached = this.logoCache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.url;
    }

    try {
      // First try to get IMDB ID for better compatibility
      let movieId = tmdbId;
      try {
        const imdbId = await IdConverter.tmdbToImdb(tmdbId, 'movie');
        if (imdbId) {
          movieId = imdbId;
          console.log(`[FanartTv] Using IMDB ID ${imdbId} for movie ${tmdbId}`);
        }
      } catch (e) {
        console.log(`[FanartTv] Could not get IMDB ID for movie ${tmdbId}, using TMDB ID`);
      }

      const response = await fetch(`${this.BASE_URL}/movies/${movieId}?api_key=${Env.FANART_API_KEY}`, {
        signal: AbortSignal.timeout(this.TIMEOUT)
      });

      if (response.ok) {
        const data = await response.json();
        console.log(`[FanartTv] Movie response for ${movieId}:`, JSON.stringify(data, null, 2));

        // Try hdmovielogo first, then movielogo
        let logoUrl: string | null = null;
        
        if (data.hdmovielogo && Array.isArray(data.hdmovielogo) && data.hdmovielogo.length > 0) {
          const logo = this.pickLogo(data.hdmovielogo, language, originalLanguage);
          if (logo && logo.url) {
            logoUrl = logo.url;
            console.log(`[FanartTv] Found hdmovielogo for ${movieId}: ${logoUrl}`);
          }
        }

        if (!logoUrl && data.movielogo && Array.isArray(data.movielogo) && data.movielogo.length > 0) {
          const logo = this.pickLogo(data.movielogo, language, originalLanguage);
          if (logo && logo.url) {
            logoUrl = logo.url;
            console.log(`[FanartTv] Found movielogo for ${movieId}: ${logoUrl}`);
          }
        }

        // Cache the result
        this.logoCache.set(cacheKey, {
          url: logoUrl,
          timestamp: Date.now()
        });

        return logoUrl;
      } else {
        console.log(`[FanartTv] Movie request failed for ${movieId}: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      console.error(`[FanartTv] Error fetching movie logo for ${tmdbId}:`, error);
    }

    // Cache null result for shorter time
    this.logoCache.set(cacheKey, {
      url: null,
      timestamp: Date.now()
    });

    return null;
  }

  /**
   * Get TV show logo from Fanart.tv
   * @param tmdbId - TMDB ID of the TV show
   * @param language - Language preference
   * @param originalLanguage - Original language of the show
   * @returns Promise<string | null> - Logo URL or null
   */
  static async getTvLogo(tmdbId: string, language: string = 'en-US', originalLanguage?: string): Promise<string | null> {
    if (!Env.FANART_API_KEY || !tmdbId) {
      return null;
    }

    const cacheKey = `tv_${tmdbId}_${language}`;
    const cached = this.logoCache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.url;
    }

    try {
      // Try to get TVDB ID first, fallback to TMDB ID
      let tvId = tmdbId;
      try {
        const tvdbId = await IdConverter.tmdbToTvdb(tmdbId);
        if (tvdbId) {
          tvId = tvdbId;
          console.log(`[FanartTv] Using TVDB ID ${tvdbId} for TV show ${tmdbId}`);
        }
      } catch (e) {
        console.log(`[FanartTv] Could not get TVDB ID for TV show ${tmdbId}, using TMDB ID`);
      }

      const response = await fetch(`${this.BASE_URL}/tv/${tvId}?api_key=${Env.FANART_API_KEY}`, {
        signal: AbortSignal.timeout(this.TIMEOUT)
      });

      if (response.ok) {
        const data = await response.json();
        console.log(`[FanartTv] TV response for ${tvId}:`, JSON.stringify(data, null, 2));

        // Try hdtvlogo first, then clearlogo
        let logoUrl: string | null = null;
        
        if (data.hdtvlogo && Array.isArray(data.hdtvlogo) && data.hdtvlogo.length > 0) {
          const logo = this.pickLogo(data.hdtvlogo, language, originalLanguage);
          if (logo && logo.url) {
            logoUrl = logo.url;
            console.log(`[FanartTv] Found hdtvlogo for ${tvId}: ${logoUrl}`);
          }
        }

        if (!logoUrl && data.clearlogo && Array.isArray(data.clearlogo) && data.clearlogo.length > 0) {
          const logo = this.pickLogo(data.clearlogo, language, originalLanguage);
          if (logo && logo.url) {
            logoUrl = logo.url;
            console.log(`[FanartTv] Found clearlogo for ${tvId}: ${logoUrl}`);
          }
        }

        // Cache the result
        this.logoCache.set(cacheKey, {
          url: logoUrl,
          timestamp: Date.now()
        });

        return logoUrl;
      } else {
        console.log(`[FanartTv] TV request failed for ${tvId}: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      console.error(`[FanartTv] Error fetching TV logo for ${tmdbId}:`, error);
    }

    // Cache null result for shorter time
    this.logoCache.set(cacheKey, {
      url: null,
      timestamp: Date.now()
    });

    return null;
  }

  /**
   * Get collection logo by trying movies within the collection
   * @param collectionId - TMDB collection ID
   * @param language - Language preference
   * @param maxMoviesToTry - Maximum number of movies to try (default: 3)
   * @returns Promise<string | null> - Logo URL or null
   */
  static async getCollectionLogo(collectionId: string, language: string = 'en-US', maxMoviesToTry: number = 3): Promise<string | null> {
    if (!Env.TMDB_ACCESS_TOKEN || !collectionId) {
      return null;
    }

    const cacheKey = `collection_${collectionId}_${language}`;
    const cached = this.logoCache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.url;
    }

    try {
      console.log(`[FanartTv] Fetching collection ${collectionId} details`);
      
      // Get collection details from TMDB
      const collectionResponse = await fetch(`https://api.themoviedb.org/3/collection/${collectionId}`, {
        headers: {
          'Authorization': `Bearer ${Env.TMDB_ACCESS_TOKEN}`
        },
        signal: AbortSignal.timeout(10000)
      });

      if (!collectionResponse.ok) {
        console.log(`[FanartTv] Collection request failed: ${collectionResponse.status}`);
        return null;
      }

      const collectionData = await collectionResponse.json();
      
      if (!collectionData.parts || !Array.isArray(collectionData.parts) || collectionData.parts.length === 0) {
        console.log(`[FanartTv] No movies found in collection ${collectionId}`);
        return null;
      }

      // Sort movies by release date (newest first) and try up to maxMoviesToTry
      const sortedMovies = collectionData.parts
        .filter((movie: any) => movie.release_date)
        .sort((a: any, b: any) => new Date(b.release_date).getTime() - new Date(a.release_date).getTime())
        .slice(0, maxMoviesToTry);

      console.log(`[FanartTv] Trying ${sortedMovies.length} movies from collection ${collectionId}`);

      // Try each movie until we find a logo
      for (const movie of sortedMovies) {
        console.log(`[FanartTv] Trying movie: ${movie.title} (${movie.id})`);
        
        const logoUrl = await this.getMovieLogo(movie.id.toString(), language, movie.original_language);
        if (logoUrl) {
          console.log(`[FanartTv] Found collection logo from movie ${movie.title}: ${logoUrl}`);
          
          // Cache the result
          this.logoCache.set(cacheKey, {
            url: logoUrl,
            timestamp: Date.now()
          });
          
          return logoUrl;
        }
      }

      console.log(`[FanartTv] No logos found for collection ${collectionId}`);
    } catch (error) {
      console.error(`[FanartTv] Error fetching collection logo for ${collectionId}:`, error);
    }

    // Cache null result
    this.logoCache.set(cacheKey, {
      url: null,
      timestamp: Date.now()
    });

    return null;
  }

  /**
   * Clear the logo cache
   */
  static clearCache(): void {
    this.logoCache.clear();
  }
}
