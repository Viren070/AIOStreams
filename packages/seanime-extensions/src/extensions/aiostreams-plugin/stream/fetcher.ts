import {
  AIOStreamsAPI,
  ParsedId,
  parseManifestUrl,
} from '../../../lib/aiostreams';
import {
  applyPreferredMapping,
  formatIdForSearch,
} from '../../../lib/aiostreams-resolver';
import { parseStremioId } from '../../../lib/stremio-id';
import { log } from '../logger';
import { ResultsPanel } from '../results-panel';
import { StreamCache } from './cache';
import { StreamPlayer } from './player';
import { toStreamResult } from './mapping';
import {
  Context,
  LookupInfo,
  StatEntry,
  StreamResult,
  WebviewState,
} from '../types';

export type SearchIdPref = 'imdbId' | 'kitsuId' | 'anilistId';

function buildLookup(
  originalId: ParsedId,
  parsedId: ParsedId,
  anime: $app.AL_BaseAnime,
  mediaType: string
): LookupInfo {
  const fmt = (id: ParsedId, suffix: string) =>
    `${id.type}: ${id.value}${id.season !== undefined ? ` · S${id.season}` : ''}${id.episode !== undefined ? ` · E${id.episode}` : ''}${suffix}`;

  const lookup: LookupInfo = {
    original: fmt(originalId, anime.format ? ` (${anime.format})` : ''),
    resolved: fmt(parsedId, mediaType ? ` (${mediaType})` : ''),
    stremioId: `${formatIdForSearch(parsedId)}${parsedId.season !== undefined ? `:${parsedId.season}` : ''}${parsedId.episode !== undefined ? `:${parsedId.episode}` : ''}`,
  };
  if (parsedId.type === 'stremioId') lookup.resolved = '—';
  return lookup;
}

function parseStremioCustomSourceId(
  siteUrl: string,
  episodeNumber: number,
  aniDBEpisode: string | undefined
): { parsedId: ParsedId; mediaType: string } | null {
  const parts = siteUrl.split('|');
  if (parts.length !== 3) return null;
  try {
    const decoded = CryptoJS.enc.Utf8.stringify(
      CryptoJS.enc.Base64.parse(parts[2])
    );
    const parsed = JSON.parse(decoded);
    if (!parsed || typeof parsed !== 'object') return null;

    const mediaType =
      typeof parsed.type === 'string' && parsed.type ? parsed.type : 'series';

    let epMapping: unknown;
    if (parsed.episodes && typeof parsed.episodes === 'object') {
      if (aniDBEpisode && aniDBEpisode in parsed.episodes) {
        epMapping = parsed.episodes[aniDBEpisode];
      } else {
        epMapping = parsed.episodes[String(episodeNumber)];
      }
    }
    if (typeof epMapping === 'string' && epMapping) {
      // Only parse the id when it uses a scheme parseStremioId actually
      // understands. For arbitrary addon-defined ids, a trailing `:N` could
      // just be a part of the id, not a season/episode.
      const isKnownScheme =
        /^tt\d+/.test(epMapping) ||
        /^(kitsu|mal|anilist|tmdb|tvdb|anidb|simkl):/.test(epMapping);
      if (isKnownScheme) {
        const parsedStremioId = parseStremioId(epMapping);
        return {
          parsedId: {
            type: 'stremioId',
            value: parsedStremioId?.baseId ?? epMapping,
            season: parsedStremioId?.season,
            episode: parsedStremioId?.episode,
          },
          mediaType,
        };
      }
      return {
        parsedId: { type: 'stremioId', value: epMapping },
        mediaType,
      };
    }

    // No per-episode mapping (single entry meta) — use the meta's own id.
    return {
      parsedId: { type: 'stremioId', value: parsed.imdb_id || parsed.id },
      mediaType,
    };
  } catch (err) {
    log.warn(
      'failed to parse custom source ID, falling back to AniList ID',
      err
    );
    return null;
  }
}

interface SearchOutcome {
  results: StreamResult[];
  episodeInfo: string;
  lookup: LookupInfo;
  cacheKey: string;
  fromCache: boolean;
  errors: StatEntry[];
  statistics: StatEntry[];
  animeLookupMs: number | null;
  searchMs: number | null;
  timeTakenMs: number;
  error: string | null;
}

export class StreamFetcher {
  lastCacheKey: string | null = null;

  constructor(
    private readonly ctx: Context,
    private readonly panel: ResultsPanel,
    private readonly player: StreamPlayer,
    private readonly cache: StreamCache,
    private readonly pendingAnime: $ui.State<$app.AL_BaseAnime | null>,
    private readonly pendingEp: $ui.State<$app.Anime_Episode | number | null>,
    private readonly setSessionId: () => string,
    private readonly resetDownloadSession: () => void
  ) {}

  private createApi(opts: { silent: boolean }): AIOStreamsAPI | null {
    const manifestUrl = $getUserPreference('manifestUrl') ?? '';
    let creds: ReturnType<typeof parseManifestUrl>;
    try {
      creds = parseManifestUrl(manifestUrl);
    } catch (err) {
      log.warn('manifest URL invalid/missing', err);
      if (!opts.silent) {
        this.ctx.toast.error(
          'AIOStreams manifest URL is invalid or missing. Configure it in the extension settings.'
        );
      }
      return null;
    }
    return new AIOStreamsAPI(
      creds.baseUrl,
      creds.uuid,
      creds.encryptedPassword
    );
  }

  // Resolves the media id, checks the cache and queries the search endpoint.
  private async performSearch(
    api: AIOStreamsAPI,
    anime: $app.AL_BaseAnime,
    episode: $app.Anime_Episode | number
  ): Promise<SearchOutcome> {
    const episodeNumber =
      typeof episode === 'number' ? episode : episode.episodeNumber;
    const aniDBEpisode =
      typeof episode === 'object' ? episode.aniDBEpisode : undefined;
    const searchId = ($getUserPreference('searchId') ??
      'imdbId') as SearchIdPref;

    const animeTitle = anime.title?.userPreferred ?? 'Unknown';
    const isMovie = String(anime.format ?? '').toUpperCase() === 'MOVIE';
    const episodeInfo = isMovie
      ? animeTitle
      : `${animeTitle} \xb7 Episode ${episodeNumber}`;

    const startTime = Date.now();
    let animeLookupMs: number | null = null;
    let searchMs: number | null = null;

    let parsedId: ParsedId | null = null;
    let mediaType: string | null = null;
    if (anime.siteUrl?.startsWith('ext_custom_source_stremio-custom-source')) {
      const parsed = parseStremioCustomSourceId(
        anime.siteUrl,
        episodeNumber,
        aniDBEpisode
      );
      if (parsed) {
        parsedId = parsed.parsedId;
        mediaType = parsed.mediaType;
      }
    }
    if (!parsedId) {
      parsedId = {
        type: 'anilistId',
        value: String(anime.id),
        episode: isMovie ? undefined : episodeNumber,
      };
    }
    mediaType = mediaType ?? (isMovie ? 'movie' : 'series');
    const originalId = { ...parsedId };

    if (parsedId.type !== 'stremioId') {
      const animeLookupStart = Date.now();
      try {
        const animeEntry = await api.anime('anilistId', anime.id);
        animeLookupMs = Date.now() - animeLookupStart;
        if (animeEntry) {
          applyPreferredMapping(parsedId, animeEntry, searchId);
          if (isMovie) {
            parsedId.season = undefined;
            parsedId.episode = undefined;
          }
          log.debug('resolved id mapping', {
            originalId,
            mappedId: parsedId,
            animeLookupMs,
          });
        }
      } catch (err) {
        animeLookupMs = Date.now() - animeLookupStart;
        log.warn(
          'failed to fetch anime details from AIOStreams, falling back to AniList ID search',
          err
        );
      }
    }

    const lookup = buildLookup(originalId, parsedId, anime, mediaType);
    const cacheKey = StreamCache.keyFor(parsedId);

    const base = {
      episodeInfo,
      lookup,
      cacheKey,
      animeLookupMs,
    };

    const cachedResults = this.cache.get(cacheKey);
    if (cachedResults) {
      log.info('cache hit', {
        cacheKey,
        count: cachedResults.length,
      });
      return {
        ...base,
        results: cachedResults,
        fromCache: true,
        errors: [],
        statistics: [],
        searchMs: null,
        timeTakenMs: Date.now() - startTime,
        error: null,
      };
    }

    log.info('cache miss, querying API', { cacheKey });
    const searchStart = Date.now();
    try {
      const id = formatIdForSearch(parsedId);
      log.debug('final id, type, season, episode sent to search endpoint', {
        id,
        type: mediaType,
        season: parsedId.season,
        episode: parsedId.episode,
      });
      const searchResponse = await api.search(
        mediaType,
        id,
        parsedId.season,
        parsedId.episode
      );
      searchMs = Date.now() - searchStart;
      const results = searchResponse.results.map(toStreamResult);
      this.cache.set(cacheKey, results);
      log.info('search complete', {
        count: results.length,
        searchMs,
        errorCount: searchResponse.errors?.length ?? 0,
      });
      return {
        ...base,
        results,
        fromCache: false,
        errors: searchResponse.errors ?? [],
        statistics: searchResponse.statistics ?? [],
        searchMs,
        timeTakenMs: Date.now() - startTime,
        error: null,
      };
    } catch (err) {
      searchMs = Date.now() - searchStart;
      log.error('stream search failed', err);
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ...base,
        results: [],
        fromCache: false,
        errors: [],
        statistics: [],
        searchMs,
        timeTakenMs: Date.now() - startTime,
        error: msg,
      };
    }
  }

  private outcomeToState(
    outcome: SearchOutcome,
    sessionId: string,
    autoPlay: boolean
  ): WebviewState {
    return {
      results: outcome.results,
      loading: false,
      error: outcome.error,
      episodeInfo: outcome.episodeInfo,
      timeTakenMs: outcome.timeTakenMs,
      animeLookupMs: outcome.animeLookupMs,
      searchMs: outcome.searchMs,
      fromCache: outcome.fromCache,
      errors: outcome.errors,
      statistics: outcome.statistics,
      lookup: outcome.lookup,
      sessionId,
      autoPlay,
    };
  }

  async fetch(
    anime: $app.AL_BaseAnime,
    episode: $app.Anime_Episode | number
  ): Promise<void> {
    const episodeNumber =
      typeof episode === 'number' ? episode : episode.episodeNumber;
    const api = this.createApi({ silent: false });
    if (!api) return;
    const searchId = ($getUserPreference('searchId') ??
      'imdbId') as SearchIdPref;

    log.info('fetching streams', {
      animeId: anime.id,
      episodeNumber,
      searchId,
      format: anime.format ?? null,
    });
    log.debug('anime details', anime);
    log.debug('episode details', episode);

    const animeTitle = anime.title?.userPreferred ?? 'Unknown';
    const isMovie = String(anime.format ?? '').toUpperCase() === 'MOVIE';
    const episodeInfo = isMovie
      ? animeTitle
      : `${animeTitle} \xb7 Episode ${episodeNumber}`;

    this.pendingAnime.set(anime);
    this.pendingEp.set(episode);

    const autoPlay = this.ctx.preferences.playback.autoPlayFirstStream;
    const sessionId = this.setSessionId();
    this.resetDownloadSession();

    this.panel.wvState.set({
      results: [],
      loading: true,
      error: null,
      episodeInfo,
      timeTakenMs: null,
      animeLookupMs: null,
      searchMs: null,
      fromCache: false,
      errors: [],
      statistics: [],
      lookup: null,
      sessionId,
      autoPlay,
    });
    this.panel.show();

    const outcome = await this.performSearch(api, anime, episode);
    this.lastCacheKey = outcome.cacheKey;
    if (!Array.isArray(outcome.results)) outcome.results = [];

    const play = !outcome.error && autoPlay && outcome.results.length > 0;
    this.applyResultsToPanel(this.outcomeToState(outcome, sessionId, play));
    if (play) this.player.play(0);
  }

  // Silently fetches and caches results for an episode without touching the
  // panel or pending refs
  async prefetch(
    anime: $app.AL_BaseAnime,
    episode: $app.Anime_Episode | number
  ): Promise<void> {
    const api = this.createApi({ silent: true });
    if (!api) return;
    try {
      const outcome = await this.performSearch(api, anime, episode);
      if (outcome.error) {
        log.warn('prefetch failed', outcome.error);
      } else {
        log.info('prefetched episode streams', {
          cacheKey: outcome.cacheKey,
          count: outcome.results.length,
          fromCache: outcome.fromCache,
        });
      }
    } catch (err) {
      log.warn('prefetch failed', err);
    }
  }

  // fetches the given episode's streams with the panel
  // hidden and plays the first result whose bingeGroup matches the stream the
  // user originally picked. Falls back to the regular presentation (panel /
  // autoPlayFirstStream) when nothing matches.
  async fetchAutoNext(
    anime: $app.AL_BaseAnime,
    episode: $app.Anime_Episode | number,
    bingeGroup: string | null
  ): Promise<void> {
    const episodeNumber =
      typeof episode === 'number' ? episode : episode.episodeNumber;
    const api = this.createApi({ silent: false });
    if (!api) return;

    log.info('auto-next fetching streams', {
      animeId: anime.id,
      episodeNumber,
      bingeGroup,
    });

    this.pendingAnime.set(anime);
    this.pendingEp.set(episode);

    const sessionId = this.setSessionId();
    this.resetDownloadSession();

    const outcome = await this.performSearch(api, anime, episode);
    this.lastCacheKey = outcome.cacheKey;
    if (!Array.isArray(outcome.results)) outcome.results = [];

    if (outcome.error) {
      this.applyResultsToPanel(this.outcomeToState(outcome, sessionId, false));
      this.ctx.toast.error(
        `Could not fetch the next episode: ${outcome.error}`
      );
      this.panel.show();
      return;
    }

    if (outcome.results.length === 0) {
      this.applyResultsToPanel(this.outcomeToState(outcome, sessionId, false));
      this.ctx.toast.info('No streams found for the next episode.');
      this.panel.show();
      return;
    }

    const matchIndex =
      bingeGroup !== null
        ? outcome.results.findIndex((r) => r.bingeGroup === bingeGroup)
        : -1;

    if (matchIndex >= 0) {
      log.info('auto-next bingeGroup match', {
        matchIndex,
        bingeGroup,
        stream: outcome.results[matchIndex].name,
      });
      this.applyResultsToPanel(this.outcomeToState(outcome, sessionId, true));
      this.ctx.toast.info(`Playing Episode ${episodeNumber}…`);
      this.player.play(matchIndex);
      return;
    }

    log.info('auto-next found no bingeGroup match', {
      bingeGroup,
      resultCount: outcome.results.length,
      autoPlayFirstStream: this.ctx.preferences.playback.autoPlayFirstStream,
    });

    if (this.ctx.preferences.playback.autoPlayFirstStream) {
      this.applyResultsToPanel(this.outcomeToState(outcome, sessionId, true));
      this.ctx.toast.info(
        `No matching stream, playing the first result for Episode ${episodeNumber}.`
      );
      this.player.play(0);
      return;
    }

    this.applyResultsToPanel(this.outcomeToState(outcome, sessionId, false));
    this.ctx.toast.info(
      'No matching stream for auto-play, pick one to continue.'
    );
    this.panel.show();
  }

  private applyResultsToPanel(state: WebviewState): void {
    this.panel.wvState.set(state);
  }

  refreshLastQuery(): void {
    if (this.lastCacheKey) this.cache.invalidate(this.lastCacheKey);
    const anime = this.pendingAnime.get();
    const ep = this.pendingEp.get();
    if (anime && ep) void this.fetch(anime, ep);
  }

  retryLastQuery(): void {
    const anime = this.pendingAnime.get();
    const ep = this.pendingEp.get();
    if (anime && ep) void this.fetch(anime, ep);
  }
}
