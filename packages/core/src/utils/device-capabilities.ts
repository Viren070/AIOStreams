/**
 * The `X-Device-Capabilities` request header: what the playing device can
 * decode, sent by clients that read `behaviorHints.deviceCapabilities` in the
 * manifest.
 *
 *   X-Device-Capabilities: v=1; video=h264,hevc; hdr=hdr10,hlg; dv=8; audio=ac3,eac3; maxres=2160
 *
 * Parsing never throws. A missing key stays `undefined` (unknown, never
 * filtered on), `none` becomes an empty list (explicitly unsupported), and
 * unknown keys and values are dropped.
 */

export const DEVICE_CAPABILITIES_HEADER = 'x-device-capabilities';
/** The highest spec version this server understands. */
export const DEVICE_CAPABILITIES_VERSION = 1;

export const DEVICE_VIDEO_CODECS = ['h264', 'hevc', 'av1', 'vp9'] as const;
export const DEVICE_HDR_FORMATS = ['hdr10', 'hdr10plus', 'hlg'] as const;
export const DEVICE_DV_PROFILES = ['5', '7', '8'] as const;
export const DEVICE_AUDIO_CODECS = [
  'aac',
  'ac3',
  'eac3',
  'truehd',
  'dts',
  'dtshd',
  'dtsx',
] as const;

export type DeviceVideoCodec = (typeof DEVICE_VIDEO_CODECS)[number];
export type DeviceHdrFormat = (typeof DEVICE_HDR_FORMATS)[number];
export type DeviceDvProfile = (typeof DEVICE_DV_PROFILES)[number];
export type DeviceAudioCodec = (typeof DEVICE_AUDIO_CODECS)[number];

export interface DeviceCapabilities {
  /** Spec version the client sent; 1 when absent or unreadable. */
  version: number;
  video?: DeviceVideoCodec[];
  hdr?: DeviceHdrFormat[];
  dv?: DeviceDvProfile[];
  audio?: DeviceAudioCodec[];
  /** Max vertical resolution in lines, e.g. 1080. */
  maxres?: number;
}

/** Guards against absurd headers; real ones are well under 200 characters. */
const MAX_HEADER_LENGTH = 1024;

function parseList<T extends string>(
  raw: string,
  allowed: readonly T[],
  normalise: (value: string) => string = (v) => v
): T[] | undefined {
  const values = raw
    .split(',')
    .map((v) => normalise(v.trim().toLowerCase()))
    .filter((v) => v.length > 0);
  const known = [
    ...new Set(values.filter((v): v is T => allowed.includes(v as T))),
  ];
  if (known.length > 0) return known;
  // Only `none` means "explicitly unsupported". A list of nothing but values
  // we don't know tells us nothing, so the key stays unknown.
  if (values.includes('none')) return [];
  return undefined;
}

/** `8.1` and `8.4` are both profile 8 for playback purposes. */
const normaliseDvProfile = (v: string) => v.replace(/^(\d+)\.\d+$/, '$1');

function parseMaxRes(raw: string): number | undefined {
  const match = /^(\d{3,4})p?$/.exec(raw.trim().toLowerCase());
  if (!match) return undefined;
  const value = Number(match[1]);
  return value >= 144 && value <= 4320 ? value : undefined;
}

/**
 * Parses the header value. Returns `undefined` when the header is absent or
 * empty, so callers keep today's behaviour.
 */
export function parseDeviceCapabilities(
  header: string | string[] | undefined | null
): DeviceCapabilities | undefined {
  if (header === undefined || header === null) return undefined;
  const raw = (Array.isArray(header) ? header.join(';') : String(header))
    .slice(0, MAX_HEADER_LENGTH)
    .trim();
  if (!raw) return undefined;

  const caps: DeviceCapabilities = { version: DEVICE_CAPABILITIES_VERSION };
  const seen = new Set<string>();

  for (const pair of raw.split(';')) {
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const key = pair.slice(0, eq).trim().toLowerCase();
    const value = pair.slice(eq + 1).trim();
    // The first occurrence of a key wins.
    if (!value || seen.has(key)) continue;
    seen.add(key);

    switch (key) {
      case 'v': {
        const version = Number(value);
        if (Number.isInteger(version) && version > 0) caps.version = version;
        break;
      }
      case 'video':
        caps.video = parseList(value, DEVICE_VIDEO_CODECS);
        break;
      case 'hdr':
        caps.hdr = parseList(value, DEVICE_HDR_FORMATS);
        break;
      case 'dv':
        caps.dv = parseList(value, DEVICE_DV_PROFILES, normaliseDvProfile);
        break;
      case 'audio':
        caps.audio = parseList(value, DEVICE_AUDIO_CODECS);
        break;
      case 'maxres':
        caps.maxres = parseMaxRes(value);
        break;
      default:
        break;
    }
  }

  for (const key of ['video', 'hdr', 'dv', 'audio', 'maxres'] as const) {
    if (caps[key] === undefined) delete caps[key];
  }
  return caps;
}

/**
 * The `device.*` constants for stream expressions. Expressions can't hold an
 * "unknown" list, so a key the client didn't send reads as fully supported
 * (matching how the built-in filter treats it); `device.keys` lists the keys
 * that were sent, for rules that need to tell the two apart.
 */
export function deviceExpressionConstants(
  caps: DeviceCapabilities | undefined
): Record<string, unknown> {
  const keys = (['video', 'hdr', 'dv', 'audio', 'maxres'] as const).filter(
    (key) => caps?.[key] !== undefined
  );
  return {
    'device.present': caps !== undefined,
    'device.version': caps?.version ?? 0,
    'device.keys': keys,
    'device.video': caps?.video ?? [...DEVICE_VIDEO_CODECS],
    'device.hdr': caps?.hdr ?? [...DEVICE_HDR_FORMATS],
    'device.dv': caps?.dv ?? [...DEVICE_DV_PROFILES],
    'device.audio': caps?.audio ?? [...DEVICE_AUDIO_CODECS],
    'device.maxres': caps?.maxres ?? 4320,
  };
}

/**
 * Whether any expression in a JSON-serialised config reads `device.*`.
 * Whitespace before the name arrives JSON-escaped (`\n`, `\t`, `\r`), so an
 * escape counts as a boundary too; a word character before it doesn't.
 */
export function configReadsDevice(serialisedConfig: string): boolean {
  return /(?:^|\\[nrt]|[^\w$.])device\.(?:present|version|keys|video|hdr|dv|audio|maxres)\b/.test(
    serialisedConfig
  );
}

/**
 * A stable string for a parsed header, used to keep per-device cache entries
 * apart. Case, spacing and unknown keys don't change it. List order does,
 * since expressions can read it (`device.video[0]`).
 */
export function deviceCapabilitiesFingerprint(
  caps: DeviceCapabilities
): string {
  const list = (v?: readonly string[]) =>
    v === undefined ? '?' : v.join(',') || 'none';
  return [
    `v${caps.version}`,
    list(caps.video),
    list(caps.hdr),
    list(caps.dv),
    list(caps.audio),
    caps.maxres ?? '?',
  ].join('|');
}
