import { parseSemVersion, compareSemVersions } from '../../lib/version';
import { DownloadManager } from './download-manager';
import { log } from './logger';
import { getPreferences } from './preferences';
import { ResultsPanel } from './results-panel';
import { AutoNextController } from './stream/auto-next';
import { StreamCache } from './stream/cache';
import { StreamFetcher } from './stream/fetcher';
import { StreamPlayer } from './stream/player';
import { AIOStreamsTray } from './tray-renderer';
import { Context, WebviewState } from './types';

const SK_CACHE_STORE = 'aio_cache';
const REQUIRED_SEANIME_VERSION = { major: 3, minor: 7, patch: 0 };

function checkSeanimeVersion(): void {
  const ver = $app.getVersion as unknown as string;
  const current = parseSemVersion(ver);
  if (compareSemVersions(current, REQUIRED_SEANIME_VERSION) < 0) {
    throw new Error(
      `AIOStreams plugin requires Seanime v${REQUIRED_SEANIME_VERSION.major}.${REQUIRED_SEANIME_VERSION.minor}.${REQUIRED_SEANIME_VERSION.patch} or higher. Current version: ${ver}. Please update Seanime to use this plugin.`
    );
  }
}

function newSessionId(): string {
  return Math.random().toString(36).slice(2);
}

function emptyWebviewState(sessionId: string): WebviewState {
  return {
    results: [],
    loading: false,
    error: null,
    episodeInfo: '',
    timeTakenMs: null,
    animeLookupMs: null,
    searchMs: null,
    fromCache: false,
    errors: [],
    statistics: [],
    lookup: null,
    sessionId,
    autoPlay: false,
  };
}

function init() {
  $ui.register<Context>((ctx) => {
    checkSeanimeVersion();
    ctx.preferences = getPreferences();
    log.info(
      `plugin loaded (Seanime v${$app.getVersion as unknown as string})`
    );
    log.debug('resolved preferences', ctx.preferences);

    let resultsSessionId = newSessionId();
    const cache = new StreamCache(ctx, SK_CACHE_STORE);
    const panel = new ResultsPanel(ctx, emptyWebviewState(resultsSessionId));
    const pendingAnime = ctx.state<$app.AL_BaseAnime | null>(null);
    const pendingEp = ctx.state<$app.Anime_Episode | number | null>(null);
    const autoNext = new AutoNextController(ctx);
    const player = new StreamPlayer(
      ctx,
      panel,
      pendingAnime,
      pendingEp,
      autoNext
    );
    const downloads = new DownloadManager(ctx, panel, () => resultsSessionId);

    const fetcher = new StreamFetcher(
      ctx,
      panel,
      player,
      cache,
      pendingAnime,
      pendingEp,
      () => {
        resultsSessionId = newSessionId();
        return resultsSessionId;
      },
      () => downloads.resetSession()
    );
    autoNext.wire(fetcher);
    if (ctx.preferences.playback.autoNext) autoNext.registerListeners();

    // Tray event handlers
    const reopenPanelHandlerId = ctx.eventHandler('aio-reopen-panel', () => {
      const st = panel.wvState.get();
      const hasResults = st.results.length > 0;
      if (!hasResults && !st.error) {
        ctx.toast.info('No previous results to show.');
        return;
      }
      if (st.autoPlay) panel.wvState.set({ ...st, autoPlay: false });
      panel.show();
      tray.close();
    });

    const clearCacheHandlerId = ctx.eventHandler('aio-clear-cache', () => {
      cache.clear();
      ctx.toast.success('AIOStreams cache cleared!');
      tray.update();
    });

    const tray = new AIOStreamsTray(ctx, panel, cache, downloads, {
      reopenPanel: reopenPanelHandlerId,
      clearCache: clearCacheHandlerId,
    });

    // Webview channel wiring
    panel.channel.on('play', (data: { index: number }) => {
      player.play(data.index);
    });

    panel.channel.on('copy-stream', (data: { text: string }) => {
      ctx.dom.clipboard.write(data.text);
      ctx.toast.success('Copied to clipboard!');
    });

    panel.channel.on('download', (data: { index: number }) => {
      downloads.start(data.index);
    });

    panel.channel.on('close', () => {
      panel.hide();
    });

    panel.channel.on('retry', () => {
      fetcher.retryLastQuery();
    });

    panel.channel.on('refresh', () => {
      fetcher.refreshLastQuery();
    });

    // Anime page button
    const episodePalette = ctx.newCommandPalette({
      placeholder: 'Select an episode...',
    });

    const animeBtn = ctx.action.newAnimePageButton({
      label: 'AIOStreams',
      tooltipText: 'Stream with AIOStreams',
    });
    if (ctx.preferences.triggers.animePageButton) animeBtn.mount();

    animeBtn.onClick(async ({ media }) => {
      animeBtn.setLoading(true);
      try {
        const entry = await ctx.anime.getAnimeEntry(media.id);
        const entryEpisodes = entry?.episodes ?? [];

        const getEpisodeTitle = (ep: $app.Anime_Episode): string => {
          const base = `Episode ${ep.episodeNumber}`;
          const title = ep.displayTitle ?? ep.episodeTitle;
          return `${base}${title ? ` – ${title}` : ''}`;
        };

        let items: {
          value: string;
          label: string;
          filterType: 'includes';
          onSelect: () => void;
        }[];

        if (entryEpisodes.length > 0) {
          items = entryEpisodes.map((ep) => ({
            value: String(ep.episodeNumber),
            label: getEpisodeTitle(ep),
            filterType: 'includes' as const,
            onSelect: () => {
              episodePalette.close();
              fetcher.fetch(media, ep);
            },
          }));
        } else {
          const total =
            media.episodes ??
            (media.nextAiringEpisode ? media.nextAiringEpisode.episode - 1 : 1);
          items = Array.from({ length: Math.max(total, 1) }, (_, i) => {
            const n = i + 1;
            return {
              value: String(n),
              label: `Episode ${n}`,
              filterType: 'includes' as const,
              onSelect: () => {
                episodePalette.close();
                fetcher.fetch(media, n);
              },
            };
          });
        }

        episodePalette.setItems(items);
        episodePalette.open();
      } catch {
        ctx.toast.error('Could not load episodes.');
      } finally {
        animeBtn.setLoading(false);
      }
    });

    // Episode card / grid context menus
    function registerItem(
      item:
        | ReturnType<typeof ctx.action.newEpisodeGridItemMenuItem>
        | ReturnType<typeof ctx.action.newEpisodeCardContextMenuItem>
    ) {
      item.mount();
      item.onClick((event) => {
        const episode = event.episode;
        if ('number' in episode) {
          ctx.toast.error(
            'Onlinestream episodes are not supported by AIOStreams.'
          );
          return;
        }
        const anime = episode.baseAnime;
        if (!anime) {
          ctx.toast.error('Could not determine anime for this episode.');
          return;
        }
        fetcher.fetch(anime, episode);
      });
    }

    if (ctx.preferences.triggers.contextMenu) {
      registerItem(
        ctx.action.newEpisodeCardContextMenuItem({
          label: 'Stream with AIOStreams',
        })
      );
    }

    if (ctx.preferences.triggers.gridMenu) {
      const gridTypes = [
        'debridstream',
        'library',
        'torrentstream',
        'undownloaded',
        'medialinks',
        'mediastream',
      ] as const;
      for (const gridType of gridTypes) {
        registerItem(
          ctx.action.newEpisodeGridItemMenuItem({
            label: 'Stream with AIOStreams',
            type: gridType,
          })
        );
      }
    }

    // Auto-open via DOM observer
    if (ctx.preferences.triggers.episodeCardClick) {
      const attach = (selector: string) => {
        ctx.dom.observe(selector, (elements) => {
          for (const el of elements) {
            if (el.attributes['data-aio-observed']) continue;
            el.setAttribute('data-aio-observed', '1');

            const mediaId = parseInt(el.attributes['data-media-id'] ?? '0', 10);
            const episodeNumber = parseInt(
              el.attributes['data-episode-number'] ?? '0',
              10
            );
            if (!mediaId || !episodeNumber) continue;

            el.addEventListener('click', () => {
              const anime = $anilist.getAnime(mediaId);
              if (!anime) {
                ctx.toast.error('AIOStreams: Could not identify anime');
                return;
              }
              fetcher.fetch(anime, episodeNumber);
            });
          }
        });
      };
      attach('[data-episode-card]');
      attach('[data-episode-grid-item]');
    }

    // Episode tab
    if (ctx.preferences.triggers.episodeTab) {
      ctx.anime.registerEntryEpisodeTab({
        name: 'AIOStreams',
        icon: 'https://cdn.jsdelivr.net/gh/selfhst/icons/png/aiostreams-light.png',
        shouldShow() {
          return true;
        },
        onEpisodeCollection(event) {
          return event.episodeCollection;
        },
        async onSelectEpisode(event) {
          const { mediaId, episodeNumber, episode } = event;
          let ep: $app.Anime_Episode | number = episode || episodeNumber;
          let anime: $app.AL_BaseAnime | undefined;
          if (episode?.baseAnime) {
            anime = episode.baseAnime;
          } else if (mediaId) {
            const entry = await ctx.anime.getAnimeEntry(mediaId);
            anime = entry ? entry.media : $anilist.getAnime(mediaId);
          }
          if (!anime) {
            ctx.toast.error('AIOStreams: Could not identify anime');
            return;
          }
          fetcher.fetch(anime, ep);
        },
      });
    }
  });
}

(globalThis as Record<string, unknown>).init = init;
