import type { EmbeddedSubtitles } from '@/lib/subtitles/embedded';
import {
  subtitleCodec,
  type FileSubtitle,
} from '@/lib/subtitles/file-subtitle';
import { ownTrackLabel } from './controller';
import type { EngineTrack, PlayerEngine } from './engine';

/** Before the number of one of the file's own subtitle tracks. */
export const EMBEDDED = 'mkv:';

export const ownSubtitleTrack = (t: FileSubtitle, i: number): EngineTrack => ({
  id: `${EMBEDDED}${t.number}`,
  type: 'subtitle',
  label: ownTrackLabel(t.name, t.language, i + 1),
  lang: t.language,
  title: t.name,
  codec: subtitleCodec(t),
  forced: t.isForced,
  hearingImpaired: t.hearingImpaired,
  default: t.isDefault,
});

/** For an engine that reads the file's own subtitles itself. */
export const ownLines = (
  embedded: () => EmbeddedSubtitles | null
): Pick<PlayerEngine, 'subtitleIndex' | 'watchLines'> => ({
  async subtitleIndex() {
    const lines = await embedded()?.index();
    if (!lines?.size) return null;
    return Object.fromEntries(
      [...lines].map(([number, spans]) => [`${EMBEDDED}${number}`, spans])
    );
  },
  watchLines(id, onLines) {
    const reading = embedded();
    if (!reading || !id.startsWith(EMBEDDED)) return () => {};
    return reading.watchLines(Number(id.slice(EMBEDDED.length)), onLines);
  },
});
