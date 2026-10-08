import type { JellyfinClient } from '../client';
import { firstInLanguages } from '../languages';
import type { MediaStream, SourceInfo } from '../types';
import { subtitleLanguages, type PlaybackPrefs } from '../user-config';

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
  const languages = subtitleLanguages(prefs);
  switch (prefs.SubtitleMode) {
    case 'None':
      return undefined;
    case 'OnlyForced': {
      const forced = subtitles.filter((s) => s.IsForced);
      return languages.length
        ? firstInLanguages(languages, forced, (s) => s.Language)
        : forced[0];
    }
    default:
      return firstInLanguages(languages, subtitles, (s) => s.Language);
  }
}
