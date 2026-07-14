import { log } from '../logger';
import { ResultsPanel } from '../results-panel';
import { AutoNextController } from './auto-next';
import { Context, StreamResult } from '../types';

const URL_TYPES = ['http', 'usenet', 'debrid', 'live', 'info'] as const;

function isUrlType(type: string): boolean {
  return (URL_TYPES as readonly string[]).includes(type);
}

export class StreamPlayer {
  constructor(
    private readonly ctx: Context,
    private readonly panel: ResultsPanel,
    private readonly pendingAnime: $ui.State<$app.AL_BaseAnime | null>,
    private readonly pendingEp: $ui.State<$app.Anime_Episode | number | null>,
    private readonly autoNext: AutoNextController
  ) {}

  play(index: number): void {
    const result = this.panel.wvState.get().results[index];
    if (!result) return;
    const anime = this.pendingAnime.get();
    const ep = this.pendingEp.get();
    if (!anime || !ep) return;

    const episodeNumber = typeof ep === 'number' ? ep : ep.episodeNumber;
    const aniDBEpisode =
      typeof ep === 'number'
        ? String(ep)
        : (ep.aniDBEpisode ?? String(ep.episodeNumber));

    const playerMode = this.ctx.preferences.playback.mode;
    const title = anime.title?.userPreferred ?? 'Unknown';
    const windowTitle = `${title} - Episode ${episodeNumber}`;

    log.info('play stream', {
      type: result.type,
      index,
      playerMode,
      episodeNumber,
    });

    if (isUrlType(result.type)) {
      this.playUrl(
        index,
        result,
        anime,
        episodeNumber,
        aniDBEpisode,
        windowTitle,
        playerMode
      );
    } else if (result.type === 'p2p') {
      this.playTorrent(
        index,
        result,
        anime,
        episodeNumber,
        aniDBEpisode,
        playerMode
      );
    }
  }

  private clearAutoPlay(): void {
    const st = this.panel.wvState.get();
    if (st.autoPlay) this.panel.wvState.set({ ...st, autoPlay: false });
  }

  private playUrl(
    index: number,
    result: StreamResult,
    anime: $app.AL_BaseAnime,
    episodeNumber: number,
    aniDBEpisode: string,
    windowTitle: string,
    playerMode: Context['preferences']['playback']['mode']
  ): void {
    if (!result.url) return;

    if (playerMode === 'external') {
      this.ctx.externalPlayerLink.open(result.url, anime.id, episodeNumber);
      this.autoNext.reset();
      this.panel.hide();
      this.panel.sendPlayError(index);
      return;
    }

    const playPromise =
      playerMode === 'builtin'
        ? this.ctx.videoCore.playStream(result.url, aniDBEpisode, anime)
        : this.ctx.playback.streamUsingMediaPlayer(
            windowTitle,
            result.url,
            anime,
            aniDBEpisode
          );

    playPromise
      .then(() => {
        this.panel.hide();
        this.autoNext.onPlaybackStarted(
          anime,
          episodeNumber,
          result,
          playerMode === 'builtin' ? 'builtin' : 'desktop'
        );
      })
      .catch((err: Error) => {
        log.error('playback failed', err);
        this.ctx.toast.error(`Playback error: ${err.message}`);
        this.panel.sendPlayError(index);
        this.clearAutoPlay();
      });
  }

  private playTorrent(
    index: number,
    result: StreamResult,
    anime: $app.AL_BaseAnime,
    episodeNumber: number,
    aniDBEpisode: string,
    playerMode: Context['preferences']['playback']['mode']
  ): void {
    if (!result.infoHash) return;

    if (!this.ctx.torrentstream.isEnabled()) {
      this.ctx.toast.error('Torrent streaming is not enabled');
      this.panel.sendPlayError(index);
      return;
    }

    const torrentstreamPlaybackType: $ui.TorrentstreamPlaybackType =
      playerMode === 'builtin'
        ? 'nativeplayer'
        : playerMode === 'external'
          ? 'externalPlayerLink'
          : 'default';

    const torrent: $app.HibikeTorrent_AnimeTorrent = {
      name: result.folderName ?? result.filename ?? '',
      date: '',
      size: result.size ?? 0,
      formattedSize: '',
      seeders: result.seeders ?? 0,
      leechers: 0,
      downloadCount: 0,
      link: result.magnetLink ?? '',
      downloadUrl: result.magnetLink ?? '',
      magnetLink: result.magnetLink ?? undefined,
      infoHash: result.infoHash,
      isBestRelease: false,
      confirmed: false,
    };

    let clientId: string | undefined = undefined;
    if (torrentstreamPlaybackType === 'nativeplayer') {
      const clientIds = $app.getClientIds();
      const platforms = clientIds.map((id) => $app.getClientPlatform(id));
      clientId = clientIds.find((id, idx) => platforms[idx] === 'denshi');
      if (!clientId) {
        this.ctx.toast.error(
          'No active compatible client found. Need Denshi client, but only found: ' +
            platforms.join(', ')
        );
        this.panel.sendPlayError(index);
        return;
      }
    }

    this.ctx.torrentstream
      .startStream({
        mediaId: anime.id,
        episodeNumber,
        aniDbEpisode: aniDBEpisode,
        fileIndex: result.fileIdx ?? undefined,
        autoSelect: result.fileIdx == null,
        playbackType: torrentstreamPlaybackType,
        torrent,
        clientId,
      })
      .then(() => {
        this.panel.hide();
        if (torrentstreamPlaybackType === 'externalPlayerLink') {
          this.autoNext.reset();
        } else {
          this.autoNext.onPlaybackStarted(
            anime,
            episodeNumber,
            result,
            torrentstreamPlaybackType === 'nativeplayer' ? 'builtin' : 'desktop'
          );
        }
      })
      .catch((err: Error) => {
        log.error('torrent stream failed', err);
        this.ctx.toast.error(`Torrent stream error: ${err.message}`);
        this.panel.sendPlayError(index);
        this.clearAutoPlay();
      });
  }
}
