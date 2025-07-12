import { Env } from './env';

const API_BASE_URL = 'https://api.themoviedb.org/3';

export async function fetchTmdbTrailer(tmdbId: string, type: 'movie' | 'tv'): Promise<string | null> {
  const url = `${API_BASE_URL}/${type}/${tmdbId}/videos`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${Env.TMDB_ACCESS_TOKEN}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) return null;
  const data = await response.json();
  if (!data.results || !Array.isArray(data.results)) return null;
  // Prefer Turkish, then English, then any
  const trailer =
    data.results.find((v: any) => v.type === 'Trailer' && v.site === 'YouTube' && v.iso_639_1 === 'tr') ||
    data.results.find((v: any) => v.type === 'Trailer' && v.site === 'YouTube' && v.iso_639_1 === 'en') ||
    data.results.find((v: any) => v.type === 'Trailer' && v.site === 'YouTube') ||
    data.results.find((v: any) => v.type === 'Clip' && v.site === 'YouTube');
  if (trailer && trailer.key) {
    return `https://www.youtube.com/watch?v=${trailer.key}`;
  }
  return null;
}
