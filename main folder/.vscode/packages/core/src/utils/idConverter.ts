import { Env } from './env';

/**
 * Utility for converting between different ID formats (TMDB, IMDB, TVDB)
 */
export class IdConverter {
  private static externalIdCache = new Map<string, any>();
  private static readonly CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

  /**
   * Get external IDs for a TMDB item
   * @param tmdbId - TMDB ID
   * @param type - 'movie' or 'tv'
   * @returns Promise<{ imdb_id?: string, tvdb_id?: string }>
   */
  static async getExternalIds(tmdbId: string, type: 'movie' | 'tv'): Promise<{ imdb_id?: string, tvdb_id?: string }> {
    const cacheKey = `${type}_${tmdbId}`;
    const cached = this.externalIdCache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.data;
    }

    try {
      const response = await fetch(`https://api.themoviedb.org/3/${type}/${tmdbId}/external_ids`, {
        headers: {
          'accept': 'application/json',
          'Authorization': `Bearer ${Env.TMDB_ACCESS_TOKEN}`
        },
        signal: AbortSignal.timeout(7000)
      });

      if (response.ok) {
        const data = await response.json();
        const result = {
          imdb_id: data.imdb_id,
          tvdb_id: data.tvdb_id
        };
        
        // Cache the result
        this.externalIdCache.set(cacheKey, {
          data: result,
          timestamp: Date.now()
        });
        
        return result;
      }
    } catch (error) {
      console.error(`[IdConverter] Error fetching external IDs for ${type} ${tmdbId}:`, error);
    }

    return {};
  }

  /**
   * Convert TMDB ID to IMDB ID
   * @param tmdbId - TMDB ID
   * @param type - 'movie' or 'tv'
   * @returns Promise<string | null>
   */
  static async tmdbToImdb(tmdbId: string, type: 'movie' | 'tv'): Promise<string | null> {
    const externalIds = await this.getExternalIds(tmdbId, type);
    return externalIds.imdb_id || null;
  }

  /**
   * Convert TMDB ID to TVDB ID (for TV shows)
   * @param tmdbId - TMDB ID
   * @returns Promise<string | null>
   */
  static async tmdbToTvdb(tmdbId: string): Promise<string | null> {
    const externalIds = await this.getExternalIds(tmdbId, 'tv');
    return externalIds.tvdb_id || null;
  }

  /**
   * Convert IMDB ID to TMDB ID using TMDB find endpoint
   * @param imdbId - IMDB ID (with or without 'tt' prefix)
   * @returns Promise<{ tmdbId: string, type: 'movie' | 'tv' } | null>
   */
  static async imdbToTmdb(imdbId: string): Promise<{ tmdbId: string, type: 'movie' | 'tv' } | null> {
    const cleanImdbId = imdbId.startsWith('tt') ? imdbId : `tt${imdbId}`;
    const cacheKey = `imdb_to_tmdb_${cleanImdbId}`;
    const cached = this.externalIdCache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.data;
    }

    try {
      const response = await fetch(`https://api.themoviedb.org/3/find/${cleanImdbId}`, {
        headers: {
          'accept': 'application/json',
          'Authorization': `Bearer ${Env.TMDB_ACCESS_TOKEN}`
        },
        signal: AbortSignal.timeout(7000)
      });

      if (response.ok) {
        const data = await response.json();
        let result = null;

        if (data.movie_results && data.movie_results.length > 0) {
          result = {
            tmdbId: data.movie_results[0].id.toString(),
            type: 'movie' as const
          };
        } else if (data.tv_results && data.tv_results.length > 0) {
          result = {
            tmdbId: data.tv_results[0].id.toString(),
            type: 'tv' as const
          };
        }

        // Cache the result
        this.externalIdCache.set(cacheKey, {
          data: result,
          timestamp: Date.now()
        });

        return result;
      }
    } catch (error) {
      console.error(`[IdConverter] Error converting IMDB ID ${cleanImdbId} to TMDB:`, error);
    }

    return null;
  }

  /**
   * Extract and normalize ID from various formats
   * @param id - ID in various formats (tmdb:123, tt123456, etc.)
   * @returns { type: 'tmdb' | 'imdb' | 'tvdb', id: string }
   */
  static parseId(id: string): { type: 'tmdb' | 'imdb' | 'tvdb', id: string } {
    if (id.startsWith('tmdb:') || id.startsWith('tmdb-')) {
      return { type: 'tmdb', id: id.replace(/^tmdb[:\-]/, '') };
    } else if (id.startsWith('tt') || id.startsWith('imdb:')) {
      return { type: 'imdb', id: id.replace(/^imdb:/, '') };
    } else if (id.startsWith('tvdb:') || id.startsWith('tvdb-')) {
      return { type: 'tvdb', id: id.replace(/^tvdb[:\-]/, '') };
    } else {
      // Assume it's a TMDB ID if it's numeric
      return { type: 'tmdb', id: id.replace(/[^0-9]/g, '') };
    }
  }

  /**
   * Clear the cache
   */
  static clearCache(): void {
    this.externalIdCache.clear();
  }
}
