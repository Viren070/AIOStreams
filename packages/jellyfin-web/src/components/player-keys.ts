import React from 'react';
import { chapterAt } from '../lib/playback/chapters';
import { currentHost } from '../lib/hosts';
import {
  focusOn,
  keyboardFocus,
  movesFocus,
  onAction,
  type ActionHandler,
  type ActionId,
} from '../lib/input';
import { useLatest } from '../lib/use-latest';
import type { PlayerController } from '../lib/playback/controller';
import { settings } from '../lib/settings';
import { delayLabel, SUBTITLE_DELAY_STEP_MS } from '../lib/subtitles/delay';
import {
  stepSubtitleHeight,
  stepSubtitleSize,
  SUBTITLE_SIZE_LABELS,
} from '../lib/subtitles/style';

export const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

const rateLabel = (rate: number) => (rate === 1 ? 'Normal' : `${rate}×`);

/** Back to a chapter's start, or the one before when it has only just begun. */
const RESTART_CHAPTER_MS = 3000;

interface PlayerKeys {
  player: PlayerController;
  /** The controls, which Back leaves before it leaves the player. */
  root: React.RefObject<HTMLElement | null>;
  wake(): void;
  hide(): void;
  notice(text: string): void;
  togglePlay(): void;
  seekBy(deltaMs: number): void;
  onBack(): void;
  onPrevious?: () => void;
  onNext?: () => void;
  /** Set while the skip button shows. */
  skipSegment?: () => void;
}

/** The player's shortcuts, each of which also shows the controls. */
export function usePlayerKeys(keys: PlayerKeys): void {
  const latest = useLatest(keys);
  const { subtitle } = keys.player.state;
  const lastSubtitle = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (subtitle) lastSubtitle.current = subtitle;
  }, [subtitle]);

  React.useEffect(() => {
    const k = () => latest.current;
    const player = () => latest.current.player;

    const nudgeVolume = (sign: number) => {
      const { state, setVolume } = player();
      const by = (sign * settings.volumeStep.read()) / 100;
      const next = Math.round((state.volume + by) * 100) / 100;
      const volume = Math.min(state.maxVolume, Math.max(0, next));
      setVolume(volume);
      k().notice(`Volume ${Math.round(volume * 100)}%`);
    };
    const nudgeSubtitles = (sign: number) => {
      const { state, setSubtitleDelay } = player();
      if (!setSubtitleDelay || !state.subtitle) return false;
      const next = state.subtitleDelayMs + sign * SUBTITLE_DELAY_STEP_MS;
      setSubtitleDelay(next);
      k().notice(`Subtitles ${delayLabel(next).toLowerCase()}`);
    };
    const resizeSubtitles = (sign: number) => {
      if (!player().state.subtitle) return false;
      const size = stepSubtitleSize(sign) ?? settings.subtitle.size.read();
      k().notice(`Subtitles ${SUBTITLE_SIZE_LABELS[size].toLowerCase()}`);
    };
    const raiseSubtitles = (sign: number) => {
      if (!player().state.subtitle) return false;
      const height =
        stepSubtitleHeight(sign) ?? settings.subtitle.position.read();
      k().notice(`Subtitle height ${height}%`);
    };
    const changeRate = (rate: number) => {
      player().setRate(rate);
      k().notice(`Speed ${rateLabel(rate).toLowerCase()}`);
    };
    const stepRate = (sign: number) => {
      const { rate } = player().state;
      const nearest = RATES.reduce(
        (best, r, i) =>
          Math.abs(r - rate) < Math.abs(RATES[best] - rate) ? i : best,
        0
      );
      const next = Math.min(RATES.length - 1, Math.max(0, nearest + sign));
      changeRate(RATES[next]);
    };
    const showSubtitle = (id: string | null) => {
      const { subtitleTracks, setSubtitle } = player();
      setSubtitle(id);
      const label = subtitleTracks.find((t) => t.id === id)?.label;
      k().notice(label ? `Subtitles: ${label}` : 'Subtitles off');
    };
    const chapterStep = (sign: number) => {
      const { chapters, state, seek } = player();
      if (!chapters?.length) return false;
      const at = chapterAt(chapters, state.positionMs);
      const into = state.positionMs - (chapters[at]?.startMs ?? 0);
      const to =
        sign > 0
          ? at + 1
          : into > RESTART_CHAPTER_MS
            ? at
            : Math.max(0, at - 1);
      const chapter = chapters[to];
      if (!chapter) return false;
      seek(chapter.startMs);
      k().notice(chapter.title || `Chapter ${to + 1}`);
    };
    const call = (fn: (() => void) | undefined) => {
      if (!fn) return false;
      fn();
    };
    /** The skip button while it shows, else play. */
    const focusControls = () => {
      const root = k().root.current;
      const target =
        root?.querySelector<HTMLElement>('[data-ui=skip-segment] button') ??
        [
          ...(root?.querySelectorAll<HTMLElement>('[data-name=play]') ?? []),
        ].find((el) => el.getClientRects().length);
      if (target) focusOn(target);
    };

    const actions: Partial<Record<ActionId, ActionHandler>> = {
      'player.controls': () => {
        if (keyboardFocus()) return false;
        focusControls();
      },
      'player.playPause': () => k().togglePlay(),
      'player.play': () => {
        if (player().state.paused) k().togglePlay();
      },
      'player.pause': () => {
        if (!player().state.paused) k().togglePlay();
      },
      'player.stop': () => k().onBack(),
      'player.skipBack': () => k().seekBy(-settings.seekStep.read() * 1000),
      'player.skipForward': () => k().seekBy(settings.seekStep.read() * 1000),
      'player.jump': (input) => {
        const { state, seek } = player();
        if (!state.durationMs) return false;
        seek((state.durationMs * Number(input)) / 10);
      },
      'player.previousChapter': () => chapterStep(-1),
      'player.nextChapter': () => chapterStep(1),
      'player.skipSegment': () => call(k().skipSegment),
      'player.previous': () => call(k().onPrevious),
      'player.next': () => call(k().onNext),
      'player.volumeUp': () => nudgeVolume(1),
      'player.volumeDown': () => nudgeVolume(-1),
      'player.mute': () => player().toggleMute(),
      'player.audio': () => {
        const { audioTracks, state, setAudio } = player();
        if (audioTracks.length < 2) return false;
        const at = audioTracks.findIndex((t) => t.id === state.audio);
        const next = audioTracks[(at + 1) % audioTracks.length];
        setAudio(next.id);
        k().notice(`Audio: ${next.label}`);
      },
      'player.subtitles': () => {
        const { subtitleTracks, state } = player();
        if (!subtitleTracks.length) return false;
        showSubtitle(
          state.subtitle ? null : (lastSubtitle.current ?? subtitleTracks[0].id)
        );
      },
      'player.nextSubtitles': () => {
        const { subtitleTracks, state } = player();
        if (!subtitleTracks.length) return false;
        const ids = [null, ...subtitleTracks.map((t) => t.id)];
        showSubtitle(ids[(ids.indexOf(state.subtitle) + 1) % ids.length]);
      },
      'player.subtitlesEarlier': () => nudgeSubtitles(-1),
      'player.subtitlesLater': () => nudgeSubtitles(1),
      'player.subtitlesSmaller': () => resizeSubtitles(-1),
      'player.subtitlesBigger': () => resizeSubtitles(1),
      'player.subtitlesLower': () => raiseSubtitles(-1),
      'player.subtitlesHigher': () => raiseSubtitles(1),
      'player.slower': () => stepRate(-1),
      'player.faster': () => stepRate(1),
      'player.normalSpeed': () => changeRate(1),
      'player.fullscreen': () => player().toggleFullscreen(),
      'player.stats': () => {
        const { stats } = player();
        if (!stats) return false;
        stats.show(stats.page ? null : '1');
      },
    };

    const stops = Object.entries(actions).map(([id, run]) =>
      onAction(id as ActionId, (input) => {
        // A control with keyboard focus moves on to the next with the arrows.
        if (keyboardFocus() && movesFocus(input)) return false;
        if (run(input) === false) return false;
        k().wake();
      })
    );
    stops.push(
      onAction('back', () => {
        const el = keyboardFocus();
        if (el && k().root.current?.contains(el)) {
          el.blur();
          k().hide();
        } else if (!currentHost().back?.()) k().onBack();
      })
    );
    return () => stops.forEach((stop) => stop());
  }, [latest]);
}
