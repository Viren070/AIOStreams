import { Env } from './env';
import { MetaPreview } from '../db/schemas';

interface CalendarItem {
  date: {
    day: number;
    month: number;
    year: number;
  };
  metaItem: MetaPreview;
  video?: {
    id: string;
    title?: string;
    released?: string;
    season?: number;
    episode?: number;
  };
  notificationEnabled?: boolean;
  notificationStatus?: 'pending' | 'sent' | 'failed';
}

interface CalendarResponse {
  items: CalendarItem[];
  monthInfo: {
    today?: number;
    days: number;
    firstWeekday: number;
  };
  selectable: {
    prev: { month: number; year: number };
    next: { month: number; year: number };
  };
  notificationSettings?: {
    enabled: boolean;
    episodeNotifications: boolean;
  };
}

/**
 * Fetch calendar data organized by date for library items
 * This matches the official Stremio calendar implementation at /calendar/year/month
 * Includes support for "Receive notifications for new episodes" toggle
 */
export async function fetchCalendarData(
  year?: number,
  month?: number,
  libraryItems?: any[],
  enableNotifications?: boolean
): Promise<CalendarResponse> {
  const now = new Date();
  const targetYear = year || now.getFullYear();
  const targetMonth = month || now.getMonth() + 1;

  try {
    // Get calendar items from library or fallback to popular content
    let calendarItems: CalendarItem[] = [];
    
    if (libraryItems && libraryItems.length > 0) {
      // Use library items (official behavior)
      calendarItems = await getLibraryCalendarItems(libraryItems, targetYear, targetMonth);
    } else {
      // Fallback: Get popular content for the month
      calendarItems = await getPopularCalendarItems(targetYear, targetMonth);
    }

    // Apply notification settings if enabled
    if (enableNotifications) {
      calendarItems = await applyNotificationSettings(calendarItems);
    }

    // Calculate month info
    const monthInfo = getMonthInfo(targetYear, targetMonth);
    
    // Calculate selectable navigation
    const selectable = getSelectableNavigation(targetYear, targetMonth);

    return {
      items: calendarItems,
      monthInfo,
      selectable,
      notificationSettings: enableNotifications ? {
        enabled: true,
        episodeNotifications: true,
      } : undefined,
    };
  } catch (error) {
    console.error('Error fetching calendar data:', error);
    return {
      items: [],
      monthInfo: getMonthInfo(targetYear, targetMonth),
      selectable: getSelectableNavigation(targetYear, targetMonth),
      notificationSettings: enableNotifications ? {
        enabled: true,
        episodeNotifications: true,
      } : undefined,
    };
  }
}

/**
 * Get calendar items from user's library (official behavior)
 */
async function getLibraryCalendarItems(
  libraryItems: any[],
  year: number,
  month: number
): Promise<CalendarItem[]> {
  const items: CalendarItem[] = [];
  
  for (const libraryItem of libraryItems) {
    try {
      // Fetch full metadata for library item
      const meta = await fetchMetaForLibraryItem(libraryItem);
      if (!meta) continue;

      // Check if item has videos for this month
      if (meta.videos && Array.isArray(meta.videos)) {
        for (const video of meta.videos) {
          if (video.released) {
            const releaseDate = new Date(video.released);
            if (releaseDate.getFullYear() === year && releaseDate.getMonth() + 1 === month) {
              items.push({
                date: {
                  day: releaseDate.getDate(),
                  month: releaseDate.getMonth() + 1,
                  year: releaseDate.getFullYear(),
                },
                metaItem: meta,
                video: {
                  id: video.id,
                  title: video.title,
                  released: video.released,
                  season: video.season,
                  episode: video.episode,
                },
              });
            }
          }
        }
      } else {
        // For items without videos, use release date
        if (meta.releaseInfo) {
          const releaseDate = new Date(meta.releaseInfo);
          if (releaseDate.getFullYear() === year && releaseDate.getMonth() + 1 === month) {
            items.push({
              date: {
                day: releaseDate.getDate(),
                month: releaseDate.getMonth() + 1,
                year: releaseDate.getFullYear(),
              },
              metaItem: meta,
            });
          }
        }
      }
    } catch (error) {
      console.error('Error processing library item:', error);
    }
  }

  return items.sort((a, b) => a.date.day - b.date.day);
}

/**
 * Fallback: Get popular content for calendar when no library
 */
async function getPopularCalendarItems(year: number, month: number): Promise<CalendarItem[]> {
  const items: CalendarItem[] = [];
  
  try {
    // Get upcoming movies and shows for this month
    const [movies, shows] = await Promise.all([
      fetchTmdbUpcoming('movie', year, month),
      fetchTmdbUpcoming('tv', year, month),
    ]);

    // Add movies
    for (const movie of movies) {
      const releaseDate = new Date(movie.release_date || movie.releaseInfo);
      items.push({
        date: {
          day: releaseDate.getDate(),
          month: releaseDate.getMonth() + 1,
          year: releaseDate.getFullYear(),
        },
        metaItem: {
          id: `tmdb:${movie.id}`,
          name: movie.title || movie.name,
          type: 'movie',
          poster: movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : undefined,
          background: movie.backdrop_path ? `https://image.tmdb.org/t/p/w1280${movie.backdrop_path}` : undefined,
          releaseInfo: movie.release_date,
          description: movie.overview,
          imdbRating: movie.vote_average?.toString(),
          genres: movie.genre_ids?.map((id: number) => getGenreName(id, 'movie')).filter(Boolean) || [],
        },
      });
    }

    // Add shows
    for (const show of shows) {
      const releaseDate = new Date(show.first_air_date || show.releaseInfo);
      items.push({
        date: {
          day: releaseDate.getDate(),
          month: releaseDate.getMonth() + 1,
          year: releaseDate.getFullYear(),
        },
        metaItem: {
          id: `tmdb:${show.id}`,
          name: show.name || show.title,
          type: 'series',
          poster: show.poster_path ? `https://image.tmdb.org/t/p/w500${show.poster_path}` : undefined,
          background: show.backdrop_path ? `https://image.tmdb.org/t/p/w1280${show.backdrop_path}` : undefined,
          releaseInfo: show.first_air_date,
          description: show.overview,
          imdbRating: show.vote_average?.toString(),
          genres: show.genre_ids?.map((id: number) => getGenreName(id, 'tv')).filter(Boolean) || [],
        },
      });
    }
  } catch (error) {
    console.error('Error fetching popular calendar items:', error);
  }

  return items.sort((a, b) => a.date.day - b.date.day);
}

/**
 * Fetch metadata for a library item
 */
async function fetchMetaForLibraryItem(libraryItem: any): Promise<MetaPreview | null> {
  try {
    // This would normally call the meta endpoint for the library item
    // For now, return a basic meta structure
    return {
      id: libraryItem.id,
      name: libraryItem.name,
      type: libraryItem.type,
      poster: libraryItem.poster,
      // Add other properties as needed
    };
  } catch (error) {
    console.error('Error fetching meta for library item:', error);
    return null;
  }
}

/**
 * Fetch upcoming content from TMDB for a specific month
 */
async function fetchTmdbUpcoming(type: 'movie' | 'tv', year: number, month: number): Promise<any[]> {
  const startDate = new Date(year, month - 1, 1).toISOString().split('T')[0];
  const endDate = new Date(year, month, 0).toISOString().split('T')[0];
  
  let url = '';
  if (type === 'movie') {
    url = `https://api.themoviedb.org/3/discover/movie?primary_release_date.gte=${startDate}&primary_release_date.lte=${endDate}&sort_by=release_date.asc`;
  } else {
    url = `https://api.themoviedb.org/3/discover/tv?first_air_date.gte=${startDate}&first_air_date.lte=${endDate}&sort_by=first_air_date.asc`;
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${Env.TMDB_ACCESS_TOKEN}`,
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error(`TMDB API error: ${response.status}`);
  }

  const data = await response.json();
  return data.results || [];
}

/**
 * Calculate month information
 */
function getMonthInfo(year: number, month: number) {
  const now = new Date();
  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);
  
  return {
    today: now.getFullYear() === year && now.getMonth() + 1 === month ? now.getDate() : undefined,
    days: lastDay.getDate(),
    firstWeekday: firstDay.getDay(), // 0 = Sunday, 1 = Monday, etc.
  };
}

/**
 * Calculate selectable navigation (prev/next month)
 */
function getSelectableNavigation(year: number, month: number) {
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;

  return {
    prev: { month: prevMonth, year: prevYear },
    next: { month: nextMonth, year: nextYear },
  };
}

/**
 * Helper function to get genre name from ID
 */
function getGenreName(id: number, type: 'movie' | 'tv'): string | null {
  const movieGenres: { [key: number]: string } = {
    28: 'Action',
    12: 'Adventure',
    16: 'Animation',
    35: 'Comedy',
    80: 'Crime',
    99: 'Documentary',
    18: 'Drama',
    10751: 'Family',
    14: 'Fantasy',
    36: 'History',
    27: 'Horror',
    10402: 'Music',
    9648: 'Mystery',
    10749: 'Romance',
    878: 'Science Fiction',
    10770: 'TV Movie',
    53: 'Thriller',
    10752: 'War',
    37: 'Western',
  };

  const tvGenres: { [key: number]: string } = {
    10759: 'Action & Adventure',
    16: 'Animation',
    35: 'Comedy',
    80: 'Crime',
    99: 'Documentary',
    18: 'Drama',
    10751: 'Family',
    10762: 'Kids',
    9648: 'Mystery',
    10763: 'News',
    10764: 'Reality',
    10765: 'Sci-Fi & Fantasy',
    10766: 'Soap',
    10767: 'Talk',
    10768: 'War & Politics',
    37: 'Western',
  };

  const genres = type === 'movie' ? movieGenres : tvGenres;
  return genres[id] || null;
}

/**
 * Apply notification settings to calendar items
 * This enables the "Receive notifications for new episodes" toggle functionality
 */
async function applyNotificationSettings(items: CalendarItem[]): Promise<CalendarItem[]> {
  return items.map(item => {
    // Only enable notifications for TV series episodes
    if (item.metaItem.type === 'series' && item.video?.episode) {
      return {
        ...item,
        notificationEnabled: true,
        notificationStatus: 'pending',
      };
    }
    return item;
  });
}

/**
 * Legacy calendar functions for backward compatibility
 */

/**
 * Fetch upcoming movies from TMDB (legacy)
 */
export async function fetchTmdbUpcomingMovies(page: number = 1, search?: string, genre?: string): Promise<any[]> {
  try {
    let url = `https://api.themoviedb.org/3/movie/upcoming?page=${page}&language=en-US&region=US`;
    
    if (search) {
      url = `https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(search)}&page=${page}&language=en-US`;
    }
    
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${Env.TMDB_ACCESS_TOKEN}`,
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error(`TMDB API error: ${response.status}`);
    }

    const data = await response.json();
    
    let results = data.results.map((movie: any) => ({
      id: `tmdb:${movie.id}`,
      name: movie.title,
      type: 'movie',
      poster: movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : undefined,
      background: movie.backdrop_path ? `https://image.tmdb.org/t/p/w1280${movie.backdrop_path}` : undefined,
      releaseInfo: movie.release_date,
      description: movie.overview,
      imdbRating: movie.vote_average ? movie.vote_average.toString() : undefined,
      genres: movie.genre_ids ? movie.genre_ids.map((id: number) => getGenreName(id, 'movie')).filter(Boolean) : [],
    }));
    
    if (genre && genre !== 'None') {
      results = results.filter((movie: any) => movie.genres.includes(genre));
    }
    
    return results;
  } catch (error) {
    console.error('Error fetching TMDB upcoming movies:', error);
    return [];
  }
}

/**
 * Fetch currently airing TV shows from TMDB (legacy)
 */
export async function fetchTmdbOnTheAir(page: number = 1, search?: string, genre?: string): Promise<any[]> {
  try {
    let url = `https://api.themoviedb.org/3/tv/on_the_air?page=${page}&language=en-US`;
    
    if (search) {
      url = `https://api.themoviedb.org/3/search/tv?query=${encodeURIComponent(search)}&page=${page}&language=en-US`;
    }
    
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${Env.TMDB_ACCESS_TOKEN}`,
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error(`TMDB API error: ${response.status}`);
    }

    const data = await response.json();
    
    let results = data.results.map((show: any) => ({
      id: `tmdb:${show.id}`,
      name: show.name,
      type: 'series',
      poster: show.poster_path ? `https://image.tmdb.org/t/p/w500${show.poster_path}` : undefined,
      background: show.backdrop_path ? `https://image.tmdb.org/t/p/w1280${show.backdrop_path}` : undefined,
      releaseInfo: show.first_air_date,
      description: show.overview,
      imdbRating: show.vote_average ? show.vote_average.toString() : undefined,
      genres: show.genre_ids ? show.genre_ids.map((id: number) => getGenreName(id, 'tv')).filter(Boolean) : [],
    }));
    
    if (genre && genre !== 'None') {
      results = results.filter((show: any) => show.genres.includes(genre));
    }
    
    return results;
  } catch (error) {
    console.error('Error fetching TMDB on the air shows:', error);
    return [];
  }
}

/**
 * Fetch TV shows airing today from TMDB (legacy)
 */
export async function fetchTmdbAiringToday(page: number = 1, search?: string, genre?: string): Promise<any[]> {
  try {
    let url = `https://api.themoviedb.org/3/tv/airing_today?page=${page}&language=en-US`;
    
    if (search) {
      url = `https://api.themoviedb.org/3/search/tv?query=${encodeURIComponent(search)}&page=${page}&language=en-US`;
    }
    
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${Env.TMDB_ACCESS_TOKEN}`,
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error(`TMDB API error: ${response.status}`);
    }

    const data = await response.json();
    
    let results = data.results.map((show: any) => ({
      id: `tmdb:${show.id}`,
      name: show.name,
      type: 'series',
      poster: show.poster_path ? `https://image.tmdb.org/t/p/w500${show.poster_path}` : undefined,
      background: show.backdrop_path ? `https://image.tmdb.org/t/p/w1280${show.backdrop_path}` : undefined,
      releaseInfo: show.first_air_date,
      description: show.overview,
      imdbRating: show.vote_average ? show.vote_average.toString() : undefined,
      genres: show.genre_ids ? show.genre_ids.map((id: number) => getGenreName(id, 'tv')).filter(Boolean) : [],
    }));
    
    if (genre && genre !== 'None') {
      results = results.filter((show: any) => show.genres.includes(genre));
    }
    
    return results;
  } catch (error) {
    console.error('Error fetching TMDB airing today shows:', error);
    return [];
  }
}