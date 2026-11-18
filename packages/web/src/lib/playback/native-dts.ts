import { currentHost } from '@/lib/hosts';
import type { EmbeddedSubtitles } from '@/lib/subtitles/embedded';
import type { EngineFile } from './engine';

export interface NativeDts {
  tracks: { ordinal?: number; label: string; language: string; codec: string; default: boolean }[];
  selected(): number;
  start(seconds: number, ordinal?: number): void;
  seek(seconds: number): void;
  setPaused(paused: boolean): void;
  destroy(): void;
}

/* eslint-disable lingui/no-unlocalized-strings -- Native media MIME types and the packaged module filename. */
/** Direct files on webOS TVs whose player can decode FLAC and need help with DTS-HD or TrueHD. */
export function canUseNativeDts(el: HTMLVideoElement, file: EngineFile) {
  if (currentHost().name !== 'webos' || file.source.IsInfiniteStream || typeof MediaSource === 'undefined') return false;
  if (!MediaSource.isTypeSupported('audio/mp4; codecs="flac"')) return false;
  const needsDts = !el.canPlayType('audio/mp4; codecs="dtsl"');
  const needsTrueHd = !el.canPlayType('audio/mp4; codecs="mlpa"');
  if (!needsDts && !needsTrueHd) return false;
  const audio = (file.source.MediaStreams ?? []).filter(s => s.Type === 'Audio' && !s.IsExternal);
  if (audio.length && audio.every(s => s.Codec)) {
    return audio.some(s =>
      (needsDts && /^(dts|dca)/i.test(s.Codec!)) ||
      (needsTrueHd && /^truehd$/i.test(s.Codec!))
    );
  }
  return /^(mkv|matroska|mp4|m4v)$/i.test(file.source.Container ?? '') || /\.(mkv|mp4|m4v)(?:[?#]|$)/i.test(file.url);
}

export async function prepareNativeDts(el: HTMLVideoElement, file: EngineFile, signal: AbortSignal,
  failed: (error: unknown) => void, supply?: EmbeddedSubtitles['supply']): Promise<NativeDts | null> {
  const embedded = new URL(__WEBGPU_PLAYER_MODULE__, new URL(__webpack_public_path__, location.href));
  const module = await import(/* webpackIgnore: true */ new URL('NativeDtsPlayback.js', embedded).href);
  if (signal.aborted) return null;
  return module.prepareNativeDtsPlayback(el, file.url, file.headers, signal, failed, supply);
}
