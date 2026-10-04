import type { JellyfinClient } from '../client';
import type { MediaStream, SourceInfo } from '../types';

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
  return new URL(client.url(path), window.location.origin).toString();
}
