export interface Metadata {
  title: string;
  titles?: string[];
  year?: number;
  yearEnd?: number;
  originalLanguage?: string;
  releaseDate?: string;
  runtime?: number; // Runtime in minutes
  seasons?: {
    season_number: number;
    episode_count: number;
  }[];
  tmdbId?: number | null;
  tvdbId?: number | null;
  genres?: string[]; // Genre names (e.g., ["Action", "Drama"])
}
