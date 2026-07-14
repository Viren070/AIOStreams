export interface StreamResult {
  infoHash: string | null;
  url: string | null;
  externalUrl: string | null;
  seeders: number | null;
  size: number | null;
  name: string | null;
  description: string | null;
  service: string | null;
  filename: string | null;
  folderName: string | null;
  cached: boolean | null;
  resolution: string | null;
  releaseGroup: string | null;
  addon: string | null;
  indexer: string | null;
  type: string;
  seadexBest: boolean | null;
  magnetLink: string | null;
  fileIdx: number | null;
  bingeGroup: string | null;
}

export interface StatEntry {
  title: string;
  description: string;
}

export interface LookupInfo {
  original: string;
  resolved: string;
  stremioId: string;
}

export interface WebviewState {
  results: StreamResult[];
  loading: boolean;
  error: string | null;
  episodeInfo: string;
  timeTakenMs: number | null;
  animeLookupMs: number | null;
  searchMs: number | null;
  fromCache: boolean;
  errors: StatEntry[];
  statistics: StatEntry[];
  lookup: LookupInfo | null;
  sessionId: string;
  autoPlay: boolean;
}

export interface DownloadRecord {
  index: number;
  filename: string;
  filePath: string;
  status: 'downloading' | 'completed' | 'error' | 'cancelled';
  error?: string;
  startedAt: number;
  completedAt?: number;
  percentage: number;
  downloadId: string;
  dismissHandlerId: string;
  cancelHandlerId: string;
}

type PlayerMode = 'desktop' | 'builtin' | 'external';

interface Preferences {
  playback: {
    mode: PlayerMode;
    autoPlayFirstStream: boolean;
    autoNext: boolean;
    prefetchNext: boolean;
  };
  cacheTtl: number;
  downloadLocation: string;
  manifestUrl: string | null;
  triggers: {
    episodeTab: boolean;
    animePageButton: boolean;
    contextMenu: boolean;
    gridMenu: boolean;
    episodeCardClick: boolean;
  };
}

export interface Context extends $ui.Context {
  preferences: Preferences;
}
