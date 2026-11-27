/** A rendition of the sound the chosen variant plays, as the page wrote it. */
export interface RewrittenSound {
  /** The rendition's language, without its region; null where none is named. */
  lang: string | null;
  /** Whether the rendition is the original sound, which plays by default. */
  original: boolean;
}

/** A playlist the page rewrote: one variant, with the sound it plays beside. */
export interface RewrittenMaster {
  text: string;
  /** The variant's lines, for the log. */
  height: number;
  /** The sound the variant plays, as the page wrote it, for the log. */
  sound: RewrittenSound[];
}

/** The attributes of an `#EXT` tag's value, quoted or not. */
function attributes(list: string): [string, string][] {
  const all: [string, string][] = [];
  let rest = list;
  for (;;) {
    const at = rest.indexOf('=');
    if (at < 0) return all;
    const name = rest.slice(0, at);
    let tail = rest.slice(at + 1);
    let value: string;
    if (tail.startsWith('"')) {
      const close = tail.indexOf('"', 1);
      if (close < 0) return all;
      value = tail.slice(1, close);
      tail = tail.slice(close + 1);
    } else {
      const comma = tail.indexOf(',');
      value = comma < 0 ? tail : tail.slice(0, comma);
      tail = comma < 0 ? '' : tail.slice(comma + 1);
    }
    all.push([name, value]);
    rest = tail.startsWith(',') ? tail.slice(1) : tail;
  }
}

const attribute = (all: [string, string][], name: string) =>
  all.find(([named]) => named === name)?.[1];

/** A tag's line with one attribute replaced, or set at its end when it has none. */
function setAttribute(line: string, name: string, value: string): string {
  const at = new RegExp(`${name}=(?:"[^"]*"|[^,]*)`);
  return at.test(line)
    ? line.replace(at, `${name}=${value}`)
    : `${line},${name}=${value}`;
}

/** A language tag's own language, without the region a TV reads in no track. */
const baseLanguage = (tag: string) => tag.split(/[-_]/)[0];

const MEDIA = '#EXT-X-MEDIA:';
const STREAM_INF = '#EXT-X-STREAM-INF:';

/**
 * The renditions, with the sound the chosen variant names playing its own
 * language: the playlist marks no rendition the default — not even the
 * original — and a TV reads a rendition's language, order and default from
 * its stream's own address, which the page cannot write. The original is
 * told by the tag the API reports, or where that matches nothing, by the
 * name the playlist gives it — `original`, as in `American English -
 * original` — and its rendition alone stays, marked the default and without
 * its language's region, so the sound has no other to start at. Sound no
 * served variant names goes too, as the group it plays is the one its line
 * says. Without an original, as a video with one sound has, the group's
 * renditions pass through.
 */
function marked(
  media: { line: string; group: string | null; audio: boolean }[],
  group: string | null,
  original: string | undefined
): { lines: string[]; sound: RewrittenSound[] } {
  const sound =
    group !== null
      ? media
          .filter((rendition) => rendition.audio && rendition.group === group)
          .map((rendition) => {
            const listed = attributes(rendition.line.slice(MEDIA.length));
            return {
              line: rendition.line,
              lang: attribute(listed, 'LANGUAGE') ?? null,
              // The id the API reports for the rendition, such as `en-US.4`.
              id: attribute(listed, 'YT-EXT-AUDIO-CONTENT-ID') ?? null,
              name: attribute(listed, 'NAME') ?? null,
            };
          })
      : [];
  const want = original?.toLowerCase();
  // At most one rendition may be the default, however its tag repeats.
  const own =
    sound.find(
      (rendition) =>
        !!want &&
        [rendition.lang, rendition.id?.split('.')[0]].some(
          (tag) => !!tag && tag.toLowerCase() === want
        )
    ) ??
    sound.find((rendition) =>
      rendition.name?.toLowerCase().includes('original')
    );
  // Sound the served variant doesn't name goes: the group it plays is the
  // one its line says, and none where its codecs carry the sound themselves.
  const named = (rendition: { group: string | null; audio: boolean }) =>
    !rendition.audio || (group !== null && rendition.group === group);
  if (!own)
    return {
      lines: media.filter(named).map((rendition) => rendition.line),
      sound: sound.map((rendition) => ({
        lang: rendition.lang,
        original: false,
      })),
    };
  // The original's line, marked the default its playlist leaves to a dub,
  // its language without the region a TV reads in no track.
  const line = setAttribute(
    own.line.replace(
      /LANGUAGE="([^"]*)"/,
      (_, lang: string) => `LANGUAGE="${baseLanguage(lang)}"`
    ),
    'DEFAULT',
    'YES'
  );
  return {
    lines: media.flatMap((rendition) => {
      if (!named(rendition)) return [];
      if (!rendition.audio) return [rendition.line];
      // The original's rendition alone: one sound, no other to start at.
      return rendition.line === own.line ? [line] : [];
    }),
    sound: [{ lang: own.lang ? baseLanguage(own.lang) : null, original: true }],
  };
}

/** The most lines a TV plays for sure, which is where YouTube's H.264 stops. */
const MAX_HEIGHT = 1080;

/**
 * The playlist with only its largest H.264 variant that has sound, beside
 * the sound stream the variant names: a TV left to pick from every size
 * starts a playlist at its smallest, and a variant's sound usually rides a
 * stream beside it that the page's own video cannot join. The variant's
 * sound plays its own language, which the playlist leaves to a dub. Null
 * when the playlist offers no variant with sound.
 */
export function rewriteMaster(
  master: string,
  base: string,
  /** The original sound's language, such as `en-US`; a video without dubs has none to mark. */
  original?: string
): RewrittenMaster | null {
  const lines = master.split('\n');
  // Every rendition stays, so the variant's group references all resolve;
  // the sound groups it can name, to tell which variants have sound.
  const sound = new Set<string>();
  const media: { line: string; group: string | null; audio: boolean }[] = [];
  const globals: string[] = [];
  const variants: {
    line: string;
    uri: string;
    height: number;
    bandwidth: number;
    /** The video codec, which is the first of the CODECS. */
    video: string;
    /** Whether the CODECS carry the variant's sound themselves. */
    own: boolean;
    /** The sound group the variant names instead, when it has one. */
    group: string | null;
  }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (line.startsWith(MEDIA)) {
      const listed = attributes(line.slice(MEDIA.length));
      const group = attribute(listed, 'GROUP-ID') ?? null;
      const audio = attribute(listed, 'TYPE') === 'AUDIO';
      if (audio && group) sound.add(group);
      media.push({
        line: line.replace(
          /URI="([^"]*)"/,
          (_, uri: string) => `URI="${new URL(uri, base).href}"`
        ),
        group,
        audio,
      });
      continue;
    }
    if (line.startsWith(STREAM_INF)) {
      const listed = attributes(line.slice(STREAM_INF.length));
      const codecs = attribute(listed, 'CODECS') ?? '';
      // The variant's link, on the line after its tag.
      const link = lines[++i]?.trim();
      if (!link || link.startsWith('#')) continue;
      variants.push({
        line,
        uri: new URL(link, base).href,
        height: Number(attribute(listed, 'RESOLUTION')?.split('x')[1]) || 0,
        bandwidth: Number(attribute(listed, 'BANDWIDTH')) || 0,
        video: codecs.split(',')[0] ?? '',
        own: codecs.includes('mp4a'),
        group: attribute(listed, 'AUDIO') ?? null,
      });
      continue;
    }
    globals.push(line);
  }
  let best: (typeof variants)[number] | null = null;
  for (const variant of variants) {
    if (
      // H.264, which every TV decodes; taller sizes are left to fall back.
      !variant.video.startsWith('avc1') ||
      variant.height > MAX_HEIGHT ||
      // Sound: the renditions of the group it names, or its own codecs.
      (variant.group ? !sound.has(variant.group) : !variant.own)
    )
      continue;
    if (
      best &&
      (variant.height < best.height ||
        (variant.height === best.height && variant.bandwidth <= best.bandwidth))
    )
      continue;
    best = variant;
  }
  if (!best) return null;
  const { lines: renditions, sound: markedFacts } = marked(
    media,
    best.group,
    original
  );
  return {
    text: [...globals, ...renditions, best.line, best.uri].join('\n') + '\n',
    height: best.height,
    sound: markedFacts,
  };
}
