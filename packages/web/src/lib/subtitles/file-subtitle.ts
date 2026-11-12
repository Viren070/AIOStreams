export type SubtitleKind = 'ass' | 'text' | 'pgs';

/** One of a video file's own subtitle tracks. */
export interface FileSubtitle {
  number: number;
  /** The container's name for the format. */
  codec: string;
  /** Null for a format the page can't draw. */
  kind: SubtitleKind | null;
  language?: string;
  name?: string;
  isDefault: boolean;
  isForced: boolean;
  hearingImpaired: boolean;
}

/* eslint-disable lingui/no-unlocalized-strings -- format names */
const CODEC_NAMES: Record<string, string> = {
  'S_TEXT/UTF8': 'subrip',
  'S_TEXT/ASCII': 'subrip',
  'S_TEXT/ASS': 'ass',
  'S_TEXT/SSA': 'ass',
  S_ASS: 'ass',
  S_SSA: 'ass',
  'S_TEXT/WEBVTT': 'webvtt',
  'D_WEBVTT/SUBTITLES': 'webvtt',
  'D_WEBVTT/CAPTIONS': 'webvtt',
  'S_HDMV/PGS': 'hdmv_pgs_subtitle',
  S_VOBSUB: 'dvd_subtitle',
  tx3g: 'mov_text',
  text: 'mov_text',
  wvtt: 'webvtt',
};
/* eslint-enable lingui/no-unlocalized-strings */

/** As the apps' players name it. */
export const subtitleCodec = (track: FileSubtitle): string | undefined =>
  CODEC_NAMES[track.codec];
