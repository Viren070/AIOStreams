import { Env } from './env';

/**
 * Fetch upcoming movies from TMDB API
 * @param page Page number for pagination
 * @returns Array of movie items with calendar-style metadata
 */
export async function fetchTmdbUpcomingMovies(page: number = 1) {
  const url = `https://api.themoviedb.org/3/movie/upcoming?page=${page}&region=US`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${Env.TMDB_ACCESS_TOKEN}` },
    signal: AbortSignal.timeout(10000),
  });
  
  if (!response.ok) {
    throw new Error(`TMDB upcoming movies request failed: ${response.statusText}`);
  }
  
  const data = await response.json();
  return data.results.map((movie: any) => ({
    id: `tmdb:${movie.id}`,
    type: 'movie',
    name: movie.title,
    poster: movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : undefined,
    background: movie.backdrop_path ? `https://image.tmdb.org/t/p/w1280${movie.backdrop_path}` : undefined,
    description: movie.overview,
    releaseInfo: movie.release_date ? new Date(movie.release_date).getFullYear().toString() : undefined,
    released: movie.release_date ? new Date(movie.release_date) : undefined,
    imdbRating: movie.vote_average ? movie.vote_average.toString() : undefined,
  }));
}

/**
 * Fetch currently airing TV shows from TMDB API
 * @param page Page number for pagination
 * @returns Array of TV show items with calendar-style metadata
 */
export async function fetchTmdbOnTheAir(page: number = 1) {
  const url = `https://api.themoviedb.org/3/tv/on_the_air?page=${page}&region=US`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${Env.TMDB_ACCESS_TOKEN}` },
    signal: AbortSignal.timeout(10000),
  });
  
  if (!response.ok) {
    throw new Error(`TMDB on the air request failed: ${response.statusText}`);
  }
  
  const data = await response.json();
  return data.results.map((show: any) => ({
    id: `tmdb:${show.id}`,
    type: 'series',
    name: show.name,
    poster: show.poster_path ? `https://image.tmdb.org/t/p/w500${show.poster_path}` : undefined,
    background: show.backdrop_path ? `https://image.tmdb.org/t/p/w1280${show.backdrop_path}` : undefined,
    description: show.overview,
    releaseInfo: show.first_air_date ? new Date(show.first_air_date).getFullYear().toString() : undefined,
    released: show.first_air_date ? new Date(show.first_air_date) : undefined,
    imdbRating: show.vote_average ? show.vote_average.toString() : undefined,
  }));
}

/**
 * Fetch TV shows airing today from TMDB API
 * @param page Page number for pagination
 * @returns Array of TV show items with calendar-style metadata
 */
export async function fetchTmdbAiringToday(page: number = 1) {
  const url = `https://api.themoviedb.org/3/tv/airing_today?page=${page}&region=US`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${Env.TMDB_ACCESS_TOKEN}` },
    signal: AbortSignal.timeout(10000),
  });
  
  if (!response.ok) {
    throw new Error(`TMDB airing today request failed: ${response.statusText}`);
  }
  
  const data = await response.json();
  return data.results.map((show: any) => ({
    id: `tmdb:${show.id}`,
    type: 'series',
    name: show.name,
    poster: show.poster_path ? `https://image.tmdb.org/t/p/w500${show.poster_path}` : undefined,
    background: show.backdrop_path ? `https://image.tmdb.org/t/p/w1280${show.backdrop_path}` : undefined,
    description: show.overview,
    releaseInfo: show.first_air_date ? new Date(show.first_air_date).getFullYear().toString() : undefined,
    released: show.first_air_date ? new Date(show.first_air_date) : undefined,
    imdbRating: show.vote_average ? show.vote_average.toString() : undefined,
  }));
}
