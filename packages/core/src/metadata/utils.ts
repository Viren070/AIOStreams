export interface TitleWithLanguage {
  title: string;
  iso_639_1: string;
  iso_3166_1?: string;
  english_name: string;
}

export interface Metadata {
  title: string;
  titles?: string[];
  titlesWithLanguages?: TitleWithLanguage[];
  year?: number;
  yearEnd?: number;
  releaseDate?: string;
  seasons?: {
    season_number: number;
    episode_count: number;
  }[];
  tmdbId?: number | null;
  tvdbId?: number | null;
}
