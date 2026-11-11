import { t } from '@lingui/core/macro';
import type React from 'react';
import { currentHost } from '@/lib/hosts';
import type { VideoFit } from '@/lib/settings';
import {
  embeddedSubtitles,
  readsOwnSubtitles,
  type EmbeddedSubtitles,
} from '@/lib/subtitles/embedded';
import type { FileSubtitle } from '@/lib/subtitles/file-subtitle';
import {
  checkSubtitleFile,
  readSubtitleFile,
  READABLE_SUBTITLE_TYPES,
} from '@/lib/subtitles/files';
import { subtitleHeight, subtitleLine } from '@/lib/subtitles/style';
import { videoSurface, type SubtitleLayer } from '@/lib/subtitles/surface';
import type {
  EngineFactory,
  EngineFile,
  EngineState,
  EngineTrack,
} from './engine';
import { ownTrackLabel } from './controller';
import { isFullscreen, toggleDocumentFullscreen } from './fullscreen';
import {
  drawSubtitle,
  ownLines,
  ownSubtitleTrack,
  ownTrackLost,
} from './page-subtitles';

/** A cue would show `{\an8}`-style tags as text. */
const cueText = (text: string) => text.replace(/\{\\[^}]*\}/g, '');

/** Null before the video says. */
function bufferedAhead(el: HTMLVideoElement): number | null {
  const { buffered, currentTime } = el;
  for (let i = 0; i < buffered.length; i++)
    if (buffered.start(i) <= currentTime && currentTime <= buffered.end(i))
      return (buffered.end(i) - currentTime) * 1000;
  return buffered.length ? 0 : null;
}

const LINK_TYPES = new Map([
  ['m3u8', 'application/vnd.apple.mpegurl'],
  ['m3u', 'application/vnd.apple.mpegurl'],
  ['ts', 'video/mp2t'],
]);

/** A failed load from another site hides its cause, but a link's type can be asked about. */
function declinesLink(el: HTMLVideoElement, url: string): boolean {
  const name = url.split(/[?#]/)[0].split('/').pop() ?? '';
  const type = LINK_TYPES.get(
    name.slice(name.lastIndexOf('.') + 1).toLowerCase()
  );
  return !!type && !el.canPlayType(type);
}

interface AudioTrack {
  enabled: boolean;
  label: string;
  language: string;
}

interface AudioTrackList extends EventTarget {
  readonly length: number;
  [index: number]: AudioTrack;
}

const audioTracksOf = (video: HTMLVideoElement) =>
  (video as { audioTracks?: AudioTrackList }).audioTracks;

const listed = (list: AudioTrackList) =>
  Array.from({ length: list.length }, (_, i) => list[i]);

interface FileTrack {
  id: string;
  label: string;
  track: TextTrack;
  text: string;
}

/**
 * The page's own `<video>`. Styled scripts and a file's own pictures draw in
 * layers over it; text shows as its text tracks.
 */
export function videoEngine(
  video: React.RefObject<HTMLVideoElement | null>
): EngineFactory {
  return (emit) => {
    let file: EngineFile | null = null;
    let elements: HTMLTrackElement[] = [];
    let files: FileTrack[] = [];
    let delayMs = 0;
    let height = subtitleHeight();
    let fit: VideoFit | undefined;
    let line = subtitleLine();
    let layer: SubtitleLayer | null = null;
    let assFailed = false;
    let embedded: EmbeddedSubtitles | null = null;
    let ownTracks: FileSubtitle[] = [];
    // The one shown as text goes through this track; a video's text tracks can't be removed.
    let ownText: { el: HTMLVideoElement; track: TextTrack } | null = null;
    let stopOwnText = () => {};
    let detach = () => {};
    // A text track's cues load late, so each one remembers the shift it has.
    const shifted = new WeakMap<TextTrack, number>();
    // Browsers disagree on where a cue the file leaves unplaced goes.
    const placed = new WeakSet<VTTCue>();

    const textTracks = () => [
      ...elements.map((e) => e.track),
      ...files.map((f) => f.track),
      ...(ownText ? [ownText.track] : []),
    ];
    const shiftCues = () => {
      for (const track of textTracks()) {
        const cues = track.cues;
        if (!cues?.length) continue;
        const by = (delayMs - (shifted.get(track) ?? 0)) / 1000;
        if (!by) continue;
        for (const cue of Array.from(cues)) {
          cue.startTime += by;
          cue.endTime += by;
        }
        shifted.set(track, delayMs);
      }
    };
    const placeCue = (vtt: VTTCue) => {
      if (vtt.line !== 'auto' && !placed.has(vtt)) return;
      placed.add(vtt);
      vtt.snapToLines = false;
      vtt.line = line;
      vtt.lineAlign = 'end';
    };
    const placeCues = () => {
      for (const track of textTracks())
        for (const cue of Array.from(track.cues ?? [])) placeCue(cue as VTTCue);
    };
    const hideOwnText = () => {
      stopOwnText();
      stopOwnText = () => {};
      const track = ownText?.track;
      if (!track) return;
      // A disabled track has no cues to remove.
      track.mode = 'hidden';
      for (const cue of Array.from(track.cues ?? [])) track.removeCue(cue);
      track.mode = 'disabled';
      shifted.delete(track);
    };
    const showOwnText = (
      el: HTMLVideoElement,
      reading: EmbeddedSubtitles,
      number: number
    ) => {
      if (ownText?.el !== el)
        ownText = { el, track: el.addTextTrack('subtitles') };
      const { track } = ownText;
      const stop = reading.read(number, {
        events(events) {
          const by = (shifted.get(track) ?? 0) / 1000;
          for (const event of events) {
            const text = cueText(event.text);
            if (!text) continue;
            const cue = new VTTCue(
              event.startMs / 1000 + by,
              event.endMs / 1000 + by,
              text
            );
            track.addCue(cue);
            placeCue(cue);
          }
          shiftCues();
        },
        lost: ownTrackLost,
      });
      if (!stop) return false;
      stopOwnText = stop;
      track.mode = 'showing';
      return true;
    };
    const listTracks = () => {
      const audio = video.current && audioTracksOf(video.current);
      const audioTracks = audio ? listed(audio) : [];
      const tracks: EngineTrack[] = [
        ...audioTracks.map((t, i) => ({
          id: String(i),
          type: 'audio' as const,
          label: ownTrackLabel(t.label, t.language, i + 1),
          lang: t.language,
          title: t.label,
        })),
        ...ownTracks.map(ownSubtitleTrack),
        ...files.map(({ id, label }) => ({
          id,
          type: 'subtitle' as const,
          label,
          external: true,
        })),
      ];
      emit({ type: 'tracks', tracks });
      const on = audioTracks.findIndex((t) => t.enabled);
      set({ audio: on < 0 ? null : String(on) });
    };
    const onTrackLoad = () => {
      placeCues();
      shiftCues();
    };
    const setSubtitle = (id: string | null) => {
      const at = file?.subtitles.findIndex((s) => s.id === id) ?? -1;
      layer?.destroy();
      layer = null;
      hideOwnText();
      const el = video.current;
      const picked = drawSubtitle(
        id,
        { own: ownTracks, embedded, server: file?.subtitles ?? [] },
        el && videoSurface(el),
        { delayMs, height },
        {
          assFailed,
          onAssFail() {
            assFailed = true;
            setSubtitle(id);
          },
        }
      );
      layer = picked.layer;
      const own = picked.own;
      if (!picked.drawn && el && own && embedded && own.kind !== 'pgs')
        showOwnText(el, embedded, own.number);
      const shown = layer ? undefined : elements[at];
      if (shown && shown.readyState >= HTMLTrackElement.LOADED) {
        const fresh = shown.cloneNode() as HTMLTrackElement;
        fresh.addEventListener('load', onTrackLoad);
        shown.removeEventListener('load', onTrackLoad);
        shown.replaceWith(fresh);
        elements[at] = fresh;
      }
      elements.forEach((e, i) => {
        e.track.mode =
          !layer && file?.subtitles[i]?.id === id ? 'showing' : 'disabled';
      });
      for (const f of files)
        f.track.mode = f.id === id ? 'showing' : 'disabled';
      shiftCues();
      set({ subtitle: id });
    };
    const set = (state: EngineState) => emit({ type: 'state', state });
    const removeElements = () => {
      for (const e of elements) e.remove();
      elements = [];
      layer?.destroy();
      layer = null;
      hideOwnText();
      embedded?.close();
      embedded = null;
      ownTracks = [];
    };

    return {
      load(next) {
        const el = video.current;
        if (!el) return;
        detach();
        removeElements();
        file = next;
        delayMs = next.subtitleDelayMs;
        elements = next.subtitles.map((s) => {
          const track = document.createElement('track');
          track.kind = 'subtitles';
          track.src = s.url;
          track.label = s.label;
          if (s.lang) track.srclang = s.lang;
          el.append(track);
          return track;
        });
        if (next.volume) {
          el.volume = Math.min(1, next.volume.volume);
          el.muted = next.volume.muted;
        }
        if (readsOwnSubtitles(next.source)) {
          const opened = embeddedSubtitles(
            next.url,
            next.headers,
            currentHost().fetchFile
          );
          embedded = opened;
          void opened.subtitles.then((found) => {
            if (embedded !== opened) return;
            ownTracks = found;
            if (ownTracks.length) listTracks();
          });
        }
        const loaded = () => {
          const reading = embedded;
          if (!reading) return emit({ type: 'loaded' });
          void reading.listed().then(() => {
            if (embedded === reading) emit({ type: 'loaded' });
          });
        };
        // Each read is a new snapshot, whose ranges may have merged since the last.
        const buffered = () => {
          const ranges = el.buffered;
          return Array.from({ length: ranges.length }, (_, i) => ({
            startMs: ranges.start(i) * 1000,
            endMs: ranges.end(i) * 1000,
          }));
        };
        const handlers: Record<string, () => void> = {
          loadedmetadata: () => {
            if (next.startMs) el.currentTime = next.startMs / 1000;
            set({ durationMs: el.duration * 1000 || 0 });
            listTracks();
            loaded();
          },
          durationchange: () => set({ durationMs: el.duration * 1000 || 0 }),
          playing: () => {
            embedded?.setPlaying(true);
            set({ started: true, paused: false, waiting: false });
          },
          pause: () => set({ paused: true }),
          play: () => set({ paused: false }),
          waiting: () => set({ waiting: true }),
          canplay: () => set({ waiting: false }),
          timeupdate: () => {
            embedded?.setPosition(el.currentTime * 1000, bufferedAhead(el));
            emit({
              type: 'position',
              positionMs: el.currentTime * 1000,
              buffered: buffered(),
            });
          },
          progress: () => emit({ type: 'position', buffered: buffered() }),
          volumechange: () => set({ volume: el.volume, muted: el.muted }),
          ratechange: () => set({ rate: el.playbackRate }),
          ended: () => emit({ type: 'ended' }),
          error: () =>
            emit({
              type: 'failed',
              error: t({
                comment: 'Follows "Playback failed:"',
                message:
                  'this browser cannot play this version. Nothing is converted on the server, so try another version, an external player or the desktop app.',
              }),
              unsupported: declinesLink(el, next.url),
            }),
        };
        for (const [event, handler] of Object.entries(handlers))
          el.addEventListener(event, handler);
        const audio = audioTracksOf(el);
        const audioEvents = ['addtrack', 'removetrack', 'change'];
        for (const event of audioEvents)
          audio?.addEventListener(event, listTracks);
        for (const e of elements) e.addEventListener('load', onTrackLoad);
        const onFullscreen = () => set({ fullscreen: isFullscreen() });
        document.addEventListener('fullscreenchange', onFullscreen);
        detach = () => {
          for (const [event, handler] of Object.entries(handlers))
            el.removeEventListener(event, handler);
          for (const event of audioEvents)
            audio?.removeEventListener(event, listTracks);
          for (const e of elements) e.removeEventListener('load', onTrackLoad);
          document.removeEventListener('fullscreenchange', onFullscreen);
        };
        onFullscreen();
        el.autoplay = !next.paused;
        if (next.paused) set({ paused: true });
        el.src = next.url;
      },
      // Browsers keep a closed player in their media controls until its video drops the stream.
      close() {
        detach();
        detach = () => {};
        removeElements();
        const el = video.current;
        if (!el) return;
        el.pause();
        el.removeAttribute('src');
        el.load();
      },
      setPaused(paused) {
        const el = video.current;
        if (!el) return;
        if (paused) el.pause();
        else void el.play().catch(() => {});
      },
      seek(ms) {
        if (video.current) video.current.currentTime = ms / 1000;
      },
      setVolume(volume, muted) {
        const el = video.current;
        if (!el) return;
        el.volume = Math.min(1, volume);
        el.muted = muted;
      },
      setRate(rate) {
        if (video.current) video.current.playbackRate = rate;
      },
      setAudio(id) {
        const audio = video.current && audioTracksOf(video.current);
        if (!audio) return;
        listed(audio).forEach((t, i) => (t.enabled = String(i) === id));
        set({ audio: id });
      },
      setSubtitle,
      setSubtitleDelay(ms) {
        delayMs = ms;
        shiftCues();
        layer?.setDelay(ms);
      },
      setStyle({ subtitleStyle, fit: nextFit, height: next }) {
        height = next;
        line = subtitleLine(subtitleStyle, next);
        placeCues();
        layer?.setHeight(next);
        if (nextFit !== fit) layer?.place();
        fit = nextFit;
      },
      toggleFullscreen: toggleDocumentFullscreen,
      ...(document.pictureInPictureEnabled && {
        togglePictureInPicture() {
          const el = video.current;
          if (!el) return;
          if (document.pictureInPictureElement === el)
            void document.exitPictureInPicture().catch(() => {});
          else void el.requestPictureInPicture().catch(() => {});
        },
      }),
      ownText: (id) => files.find((f) => f.id === id)?.text ?? null,
      ...ownLines(() => embedded),
      subtitleFiles: {
        types: READABLE_SUBTITLE_TYPES,
        add: async (added) => {
          checkSubtitleFile(added, READABLE_SUBTITLE_TYPES);
          const { text, cues } = await readSubtitleFile(added);
          const el = video.current;
          if (!el) return;
          const track = el.addTextTrack('subtitles', added.name);
          track.mode = 'hidden';
          for (const cue of cues)
            track.addCue(
              new VTTCue(cue.startMs / 1000, cue.endMs / 1000, cue.text)
            );
          const id = `file:${files.length}`;
          files = [...files, { id, label: added.name, track, text }];
          listTracks();
          placeCues();
          setSubtitle(id);
        },
      },
      fits: true,
    };
  };
}
