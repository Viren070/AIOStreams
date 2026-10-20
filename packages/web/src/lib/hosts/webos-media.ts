import { t } from '@lingui/core/macro';
import { ofType, subtitleName } from '../playback/controller';
import type { EngineTrack } from '../playback/engine';
import { SUBTITLE_SIZES, type SubtitleStyle } from '../settings';
import type { SourceInfo } from '../types';

interface ServiceBridge {
  onservicecallback?: (message: string) => void;
  call(uri: string, params: string): void;
  cancel?(): void;
}

declare global {
  interface Window {
    PalmServiceBridge?: new () => ServiceBridge;
  }
  interface HTMLVideoElement {
    /** webOS names each video's pipeline, which the media service is told. */
    mediaId?: string;
  }
}

const EMBEDDED = 'embedded:';
// The TV's own renderer draws text subtitles only.
const IMAGE_CODEC = /pgs|vobsub|dvd_?sub|dvb_?sub/i;
// Formats LG TVs often leave out; the TV's audio EDID says which it has.
const OPTIONAL_AUDIO = [
  { name: 'dts', codec: /^dts|dca/i },
  { name: 'truehd', codec: /truehd|mlp/i },
];
const MEDIA_ID_POLL_MS = 300;
const MEDIA_ID_TRIES = 40;
// webOS ignores a track picked straight after subtitles are switched on.
const SELECT_DELAY_MS = 500;
// The colours the TV's subtitle renderer takes, by name.
const COLOURS: Record<string, [number, number, number]> = {
  black: [0, 0, 0],
  white: [255, 255, 255],
  yellow: [255, 255, 0],
  red: [255, 0, 0],
  green: [0, 255, 0],
  blue: [0, 0, 255],
};

/** Calls a luna service and resolves with its reply. */
function luna<T = unknown>(
  method: string,
  parameters: Record<string, unknown>,
  service = 'com.webos.media'
) {
  return new Promise<T>((resolve, reject) => {
    const Bridge = window.PalmServiceBridge;
    if (!Bridge) return reject(new Error('no PalmServiceBridge'));
    const bridge = new Bridge();
    /** Settles the call with the service's reply. */
    bridge.onservicecallback = (message) => {
      try {
        const reply = JSON.parse(message) as T & { returnValue?: boolean };
        if (reply.returnValue === false) reject(new Error(message));
        else resolve(reply);
      } catch {
        resolve({} as T);
      }
    };
    bridge.call(`luna://${service}/${method}`, JSON.stringify(parameters));
  });
}

/** The renderer's colour nearest to a `#rrggbb` one. */
function nearestColour(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  let best = 'white';
  let distance = Infinity;
  for (const [name, c] of Object.entries(COLOURS)) {
    const d = c.reduce((sum, v, i) => sum + (v - rgb[i]!) ** 2, 0);
    if (d < distance) [best, distance] = [name, d];
  }
  return best;
}

/** The app's subtitle look in the TV renderer's terms. */
function rendererStyle(style: SubtitleStyle) {
  // The renderer's 0 to 4; its 4 is larger than any size here.
  const fontSize = Math.max(0, SUBTITLE_SIZES.indexOf(style.size));
  // -3 sits lowest; the app raises subtitles by a percentage of the height.
  const position =
    style.position <= 0
      ? -3
      : style.position <= 5
        ? -2
        : style.position <= 10
          ? 0
          : style.position <= 15
            ? 2
            : 4;
  const background = style.backgroundOpacity > 0;
  return {
    setSubtitleFontSize: { fontSize },
    setSubtitlePosition: { position },
    setSubtitleCharacterColor: { charColor: nearestColour(style.textColor) },
    setSubtitleCharacterOpacity: { charOpacity: 255 },
    setSubtitleBackgroundColor: {
      bgColor: background ? nearestColour(style.backgroundColor) : 'black',
    },
    setSubtitleBackgroundOpacity: {
      bgOpacity: background ? Math.round(style.backgroundOpacity * 2.55) : 0,
    },
  };
}

/** The file's own text subtitles, as the server describes them. */
export function embeddedSubtitles(source: SourceInfo): EngineTrack[] {
  return ofType(source, 'Subtitle')
    .filter(
      (s) =>
        s.DeliveryMethod === 'Embed' &&
        s.IsTextSubtitleStream !== false &&
        !IMAGE_CODEC.test(s.Codec ?? '')
    )
    .map((s, n) => ({
      id: `${EMBEDDED}${n}`,
      type: 'subtitle' as const,
      label: subtitleName(s, n + 1),
      detail: t`Embedded`,
      lang: s.Language ?? undefined,
      title: s.Title ?? undefined,
      forced: s.IsForced ?? undefined,
      hearingImpaired: s.IsHearingImpaired ?? undefined,
      default: s.IsDefault ?? undefined,
    }));
}

export const isEmbedded = (id: string | null) => !!id?.startsWith(EMBEDDED);

let decodes: Promise<Set<string>> | null = null;

/** The optional audio formats this TV decodes, read once from its EDID. */
function decodedFormats() {
  decodes ??= luna<{ configs?: Record<string, string> }>(
    'getConfigs',
    { configNames: ['tv.model.edidType'] },
    'com.webos.service.config'
  )
    /** The optional formats the EDID lists. */
    .then(({ configs }) => {
      const edid = (configs?.['tv.model.edidType'] ?? '').toLowerCase();
      return new Set(
        OPTIONAL_AUDIO.filter((f) => edid.includes(f.name)).map((f) => f.name)
      );
    })
    .catch(() => new Set<string>());
  return decodes;
}

/**
 * Reaches LG's media pipeline, which a plain `<video>` can't: the file's own
 * subtitles, switching audio tracks, the subtitle look, and the audio formats
 * the TV decodes. Null off webOS.
 */
export function webosMedia(onDecoders?: () => void) {
  if (!window.PalmServiceBridge) return null;
  let video: HTMLVideoElement | null = null;
  let mediaId: string | null = null;
  let subtitle: number | null = null;
  let audio: number | null = null;
  let style: SubtitleStyle | undefined;
  let enabled = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let pending: ReturnType<typeof setTimeout> | undefined;
  // Unknown until the TV answers, and nothing is held back meanwhile.
  let formats: Set<string> | null = null;
  /** Remembers what the TV decodes and lets the player re-list its tracks. */
  void decodedFormats().then((found) => {
    formats = found;
    onDecoders?.();
  });

  /** Ends any wait for the pipeline or for a pending track pick. */
  const stop = () => {
    clearInterval(timer);
    clearTimeout(pending);
    timer = undefined;
    pending = undefined;
  };

  /** Sends the subtitle look to the renderer. */
  const applyStyle = (id: string) => {
    if (!style) return;
    for (const [method, value] of Object.entries(rendererStyle(style)))
      void luna(method, { mediaId: id, ...value }).catch(() => {});
  };

  /** Makes the renderer show the chosen subtitle, or none. */
  const applySubtitle = () => {
    if (!mediaId) return;
    const id = mediaId;
    clearTimeout(pending);
    if (subtitle === null) {
      if (enabled) {
        enabled = false;
        void luna('setSubtitleEnable', { mediaId: id, enable: false }).catch(
          () => {}
        );
      }
      return;
    }
    const index = subtitle;
    void luna('setSubtitleEnable', { mediaId: id, enable: true })
      .then(() => {
        enabled = true;
        // Off may have been chosen while this was on its way.
        if (subtitle === null) return applySubtitle();
        applyStyle(id);
        pending = setTimeout(() => {
          if (mediaId === id && subtitle === index)
            void luna('selectTrack', {
              type: 'text',
              mediaId: id,
              index,
            }).catch(() => {});
        }, SELECT_DELAY_MS);
      })
      .catch(() => {});
  };

  /** The `<video>`'s own audio switch isn't always heard by the pipeline. */
  const applyAudio = () => {
    if (!mediaId || audio === null) return;
    void luna('selectTrack', {
      type: 'audio',
      mediaId,
      index: audio,
    }).catch(() => {});
  };

  /** The pipeline names itself a little after the source is set. */
  const waitForMediaId = () => {
    stop();
    let tries = 0;
    timer = setInterval(() => {
      const id = String(video?.mediaId ?? '').trim();
      if (id && id !== '<invalid mediaId>') {
        stop();
        mediaId = id;
        applyAudio();
        applySubtitle();
      } else if (++tries > MEDIA_ID_TRIES) stop();
    }, MEDIA_ID_POLL_MS);
  };

  return {
    /** A new file is set on `el`. */
    load(el: HTMLVideoElement) {
      video = el;
      mediaId = null;
      subtitle = null;
      audio = null;
      enabled = false;
      waitForMediaId();
    },
    /** Shows the embedded subtitle with this id, or none. */
    selectSubtitle(id: string | null) {
      subtitle = isEmbedded(id) ? Number(id!.slice(EMBEDDED.length)) : null;
      applySubtitle();
    },
    /** Plays the audio track at this place in the `<video>`'s list. */
    selectAudio(index: number) {
      audio = index;
      applyAudio();
    },
    /** The look the renderer draws subtitles in. */
    setStyle(next: SubtitleStyle | undefined) {
      style = next;
      if (mediaId && enabled) applyStyle(mediaId);
    },
    /** Whether the TV decodes the audio a server stream describes. */
    decodes(codec: string | null | undefined) {
      const optional = OPTIONAL_AUDIO.find((f) => f.codec.test(codec ?? ''));
      return !optional || !formats || formats.has(optional.name);
    },
    /** The player is done with this file. */
    close() {
      stop();
      subtitle = null;
      applySubtitle();
      video = null;
      mediaId = null;
    },
  };
}
