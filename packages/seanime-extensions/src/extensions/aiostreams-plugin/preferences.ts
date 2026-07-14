import { parseManifestUrl } from '../../lib/aiostreams';
import { Context } from './types';

export function getPreferences(): Context['preferences'] {
  return {
    playback: {
      mode: getPlayerModePref(),
      autoPlayFirstStream: prefBool('autoPlayFirstStream', false),
      autoNext: prefBool('autoPlayNextEpisode', true),
      prefetchNext: prefBool('prefetchNextEpisode', false),
    },
    cacheTtl: getCacheTtlMinutes(),
    downloadLocation: resolveDownloadDir(),
    manifestUrl: getConfigureUrl(),
    triggers: {
      episodeTab: prefBool('showAnimeTab', true),
      animePageButton: prefBool('showAnimePageButton', true),
      contextMenu: prefBool('showEpisodeContextMenu', true),
      gridMenu: prefBool('showEpisodeGridMenu', true),
      episodeCardClick: prefBool('autoOpenResults', false),
    },
  };
}

function prefBool(key: string, def: boolean): boolean {
  const v = $getUserPreference(key);
  if (v === undefined || v === null || v === '') return def;
  return v === 'true';
}

function getPlayerModePref(): Context['preferences']['playback']['mode'] {
  const mode = ($getUserPreference('playerMode') ?? '').trim();
  if (mode === 'desktop' || mode === 'builtin' || mode === 'external') {
    return mode;
  }
  if (prefBool('useExternalPlayer', false)) return 'external';
  return 'desktop';
}

function getCacheTtlMinutes(): number {
  const v = $getUserPreference('cacheTtl');
  if (!v) return 30;
  const n = parseInt(v, 10);
  return isNaN(n) || n < 0 ? 30 : n;
}

function resolveDownloadDir(): string {
  const pref = ($getUserPreference('downloadLocation') ?? '$DOWNLOAD').trim();
  if (!pref) return $osExtra.downloadDir();

  const replacements: Array<[string, () => string]> = [
    ['$DOWNLOAD', () => $osExtra.downloadDir()],
    ['$DESKTOP', () => $osExtra.desktopDir()],
    ['$DOCUMENT', () => $osExtra.documentsDir()],
    ['$HOME', () => $os.homeDir()],
  ];

  for (const [token, getBase] of replacements) {
    if (pref.startsWith(token)) {
      const base = getBase();
      if (!base) continue;
      const rest = pref.slice(token.length).replace(/^[/\\]/, '');
      return rest ? $filepath.join(base, rest) : base;
    }
  }

  return pref;
}

function getConfigureUrl(): string | null {
  const url = ($getUserPreference('manifestUrl') ?? '').trim();
  if (!url) return null;
  try {
    parseManifestUrl(url);
  } catch {
    return null;
  }
  return url.replace(/\/manifest\.json(\?.*)?$/, '/configure$1');
}
