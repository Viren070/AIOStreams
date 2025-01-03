// the data that is parsed from a filename
export interface ParsedNameData {
  resolution: string;
  quality: string;
  encode: string;
  visualTags: string[];
  audioTags: string[];
  languages: string[];
}

// the parsed stream data which is to be used to create the final stream object
export interface ParsedStream extends ParsedNameData {
  addon: {
    id: string;
    name: string;
  };
  filename?: string;
  size?: number;
  provider?: {
    name: string;
    cached?: boolean;
  };
  torrent?: {
    infoHash?: string;
    fileIdx?: number;
    seeders?: number;
    sources?: string[];
  };
  usenet?: {
    age?: string;
  };
  url?: string;
  externalUrl?: string;
  indexers?: string;
  stream?: {
    subtitles?: Subtitle[];
    behaviorHints?: {
      countryWhitelist?: string[];
      notWebReady?: boolean;
      proxyHeaders?: {
        request?: { [key: string]: string };
        response?: { [key: string]: string };
      };
      videoHash?: string;
    };
  };
}

export interface CollectedParsedStreams {
  [key: string]: ParsedStream[];
}

export interface Stream {
  url?: string;
  externalUrl?: string;
  infoHash?: string;
  fileIdx?: number;
  name?: string;
  title?: string;
  description?: string;
  subtitles?: Subtitle[];
  sources?: string[];
  behaviorHints?: {
    countryWhitelist?: string[];
    notWebReady?: boolean;
    bingeGroup?: string;
    proxyHeaders?: {
      request?: { [key: string]: string };
      response?: { [key: string]: string };
    };
    videoHash?: string;
    videoSize?: number;
    filename?: string;
  };
}

export interface Subtitle {
  id: string;
  url: string;
  lang: string;
}

export interface StreamRequest {
  id: string;
  type: 'series' | 'movie';
}

export type Resolution = { [key: string]: boolean };
export type Quality = { [key: string]: boolean };
export type VisualTag = { [key: string]: boolean };
export type AudioTag = { [key: string]: boolean };
export type Encode = { [key: string]: boolean };
export type SortBy = { [key: string]: boolean };

export interface Config {
  resolutions: Resolution[];
  qualities: Quality[];
  visualTags: VisualTag[];
  audioTags: AudioTag[];
  encodes: Encode[];
  sortBy: SortBy[];
  onlyShowCachedStreams: boolean;
  prioritiseLanguage: string | null;
  formatter: string;
  customFormatter?: {
    splitter: string; // e.g. ' - ', ' | ' etc. the string used to split the tags
    // we need to have a key for where the value has to be determined from the stream data.
    // examples of this is provider and seedersOrAge. provider.cached has different states and seedersOrAge has different states

    // available values:
    // {resolution}, {quality}, {streamType} {encode}, {visualTags}, {audioTags}, {languages}, {provider}, {seedersOrAge}, {filename}, {size}, {addonName}, {seedersOrAge}
    languages: {
      useEmojis: boolean; // e.g. 🇬🇧
    };
    hideIfUnknown: boolean; // if true, the tag will not be shown if the value is unknown
    provider: {
      trueCacheStatus: string; // e.g. ⚡️
      falseCacheStatus: string; // e.g. ⏳
      undefinedCacheStatus: string; // e.g. ❓
      finalString: string; // e.g. [{providerShortName}{cacheStatus}]  ->  [TB⚡️] or this could be left empty
    };
    streamType: {
      torrent: string; // e.g. 🧲
      usenet: string; // e.g. 📡
      direct: string; // e.g. 📥
      unknown: string; // e.g. ❓
      finalString: string; // e.g. {streamType}  ->  🧲
    };
    seedersOrAge: {
      whenSeeders: string; // e.g. 👤
      whenAge: string; // e.g. 📅
      finalString: string; // e.g. {seedersOrAge} {seedersOrAgeValue}
    };
    name: string;
    description: string;
  };
  maxSize?: number | null;
  minSize?: number | null;
  maxMovieSize: number | null;
  minMovieSize: number | null;
  maxEpisodeSize: number | null;
  minEpisodeSize: number | null;
  addons: {
    id: string;
    options: { [key: string]: string | undefined };
  }[];
  services: {
    name: string;
    id: string;
    enabled: boolean;
    credentials: { [key: string]: string };
  }[];
}

interface BaseOptionDetail {
  id: string;
  required?: boolean;
  label: string;
  description?: string;
}

export interface TextOptionDetail extends BaseOptionDetail {
  type: 'text';
}

export interface SelectOptionDetail extends BaseOptionDetail {
  type: 'select';
  options: { value: string; label: string }[];
}

export interface CheckboxOptionDetail extends BaseOptionDetail {
  type: 'checkbox';
}

export interface NumberOptionDetail extends BaseOptionDetail {
  type: 'number';
  constraints: {
    min?: number;
    max?: number;
  };
}

export type AddonOptionDetail =
  | TextOptionDetail
  | SelectOptionDetail
  | CheckboxOptionDetail
  | NumberOptionDetail;

export interface AddonDetail {
  name: string;
  id: string;
  requiresService: boolean;
  supportedServices: string[];
  options?: AddonOptionDetail[];
}
