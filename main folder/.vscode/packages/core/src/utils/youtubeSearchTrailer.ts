import { google } from 'googleapis';

// You must set Env.YOUTUBE_API_KEY in your environment for this to work in production
import { Env } from './env';

export async function searchYoutubeTrailer(title: string, year?: string): Promise<string | null> {
  const apiKey = Env.YOUTUBE_API_KEY;
  if (!apiKey) return null;
  const youtube = google.youtube({ version: 'v3', auth: apiKey });
  let q = `${title} trailer`;
  if (year) q += ` ${year}`;
  try {
    const res = await youtube.search.list({
      part: ['snippet'],
      q,
      type: ['video'],
      maxResults: 3,
      videoEmbeddable: 'true',
      safeSearch: 'strict',
    });
    const item = res.data.items?.[0];
    if (item && item.id && item.id.videoId) {
      return `https://www.youtube.com/watch?v=${item.id.videoId}`;
    }
    return null;
  } catch (e) {
    return null;
  }
}
