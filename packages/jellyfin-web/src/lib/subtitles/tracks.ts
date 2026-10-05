import type { JellyfinClient } from '../client';
import { sameLanguage } from '../languages';
import type { MediaStream, SourceInfo } from '../types';
import type { PlaybackPrefs } from '../user-config';

export function textSubtitles(source: SourceInfo): MediaStream[] {
  return (source.MediaStreams ?? []).filter(
    (s) => s.Type === 'Subtitle' && s.DeliveryMethod === 'External'
  );
}

/**
 * An absolute address for an external subtitle stream, converted to the
 * WebVTT a `<video>` element reads unless `original` keeps the file's format.
 */
export function subtitleUrl(
  client: JellyfinClient,
  stream: MediaStream,
  { original = false } = {}
): string | null {
  if (!stream.DeliveryUrl) return null;
  const path = original
    ? stream.DeliveryUrl
    : stream.DeliveryUrl.replace(/Stream\.\w+(?=\?|$)/, 'Stream.vtt');
  return new URL(client.url(path), window.location.href).toString();
}

/** The subtitle the user's language and subtitle mode start with. */
export function preferredSubtitle<
  T extends Pick<MediaStream, 'Language' | 'IsForced'>,
>(subtitles: T[], prefs: PlaybackPrefs): T | undefined {
  const lang = prefs.SubtitleLanguagePreference;
  switch (prefs.SubtitleMode) {
    case 'None':
      return undefined;
    case 'OnlyForced':
      return subtitles.find(
        (s) => s.IsForced && (!lang || sameLanguage(lang, s.Language))
      );
    default:
      return lang
        ? subtitles.find((s) => sameLanguage(lang, s.Language))
        : undefined;
  }
}
