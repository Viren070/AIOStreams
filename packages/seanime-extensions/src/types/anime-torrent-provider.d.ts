declare type AnimeProviderSmartSearchFilter =
  | 'batch'
  | 'episodeNumber'
  | 'resolution'
  | 'query'
  | 'bestReleases';

declare type AnimeProviderType = 'main' | 'special';

declare interface AnimeProviderSettings {
  canSmartSearch: boolean;
  smartSearchFilters: AnimeProviderSmartSearchFilter[];
  supportsAdult: boolean;
  type: AnimeProviderType;
}

declare interface Media {
  id: number;
  idMal?: number;
  status?: string;
  format?: string;
  englishTitle?: string;
  romajiTitle?: string;
  episodeCount?: number;
  absoluteSeasonOffset?: number;
  synonyms: string[];
  isAdult: boolean;
  startDate?: FuzzyDate;
}

declare interface FuzzyDate {
  year: number;
  month?: number;
  day?: number;
}

declare interface AnimeSearchOptions {
  media: Media;
  query: string;
}

declare interface AnimeSmartSearchOptions {
  media: Media;
  query: string;
  batch: boolean;
  episodeNumber: number;
  resolution: string;
  anidbAID: number;
  anidbEID: number;
  bestReleases: boolean;
}

declare interface AnimeTorrent {
  name: string;
  date: string;
  size: number;
  formattedSize: string;
  seeders: number;
  leechers: number;
  downloadCount: number;
  link: string;
  downloadUrl?: string;
  magnetLink?: string;
  infoHash?: string;
  resolution?: string;
  isBatch?: boolean;
  episodeNumber: number;
  releaseGroup?: string;
  isBestRelease: boolean;
  confirmed: boolean;
}
