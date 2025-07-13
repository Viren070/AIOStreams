import { Env } from './env';
import { MetaPreview } from '../db/schemas';

/**
 * Fetch upcoming movies from TMDB
 */
export async function fetchTmdbUpcomingMovies(page: number = 1, search?: string, genre?: string): Promise<MetaPreview[]> {
  try {
    let url = `https://api.themoviedb.org/3/movie/upcoming?page=${page}&language=en-US&region=US`;
    
    // If search is provided, use search endpoint instead
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
    
    // Filter by genre if specified
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
 * Fetch currently airing TV shows from TMDB
 */
export async function fetchTmdbOnTheAir(page: number = 1, search?: string, genre?: string): Promise<MetaPreview[]> {
  try {
    let url = `https://api.themoviedb.org/3/tv/on_the_air?page=${page}&language=en-US`;
    
    // If search is provided, use search endpoint instead
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
    
    // Filter by genre if specified
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
 * Fetch TV shows airing today from TMDB
 */
export async function fetchTmdbAiringToday(page: number = 1, search?: string, genre?: string): Promise<MetaPreview[]> {
  try {
    let url = `https://api.themoviedb.org/3/tv/airing_today?page=${page}&language=en-US`;
    
    // If search is provided, use search endpoint instead
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
    
    // Filter by genre if specified
    if (genre && genre !== 'None') {
      results = results.filter((show: any) => show.genres.includes(genre));
    }
    
    return results;
  } catch (error) {
    console.error('Error fetching TMDB airing today shows:', error);
    return [];
  }
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