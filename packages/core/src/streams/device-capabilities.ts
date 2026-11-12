import type { ParsedStream } from '../db/schemas.js';
import type {
  DeviceAudioCodec,
  DeviceCapabilities,
  DeviceVideoCodec,
} from '../utils/device-capabilities.js';

/**
 * Decides whether a stream will play on a device from its parsed tags, and
 * applies the user's "Respect device capabilities" setting to a finished
 * stream list. It runs after the pipeline cache, so it never changes what is
 * cached for the other devices sharing a configuration.
 *
 * Everything here leans towards "playable": a capability the client left out,
 * or a tag we can't map to the spec, never removes a stream.
 */

export type DeviceCapabilitiesMode = 'off' | 'deprioritise' | 'exclude';

export type UnplayableReason =
  'video' | 'dynamicRange' | 'audio' | 'resolution';

const ENCODE_TO_CODEC: Record<string, DeviceVideoCodec> = {
  AVC: 'h264',
  HEVC: 'hevc',
  AV1: 'av1',
};

/**
 * Each audio tag, and the device codecs that can play it in order of
 * preference. The DTS family carries a DTS core, so a DTS-only device still
 * plays DTS-HD and DTS:X.
 */
const AUDIO_TAG_TO_CODECS: Record<string, DeviceAudioCodec[]> = {
  AAC: ['aac'],
  DD: ['ac3'],
  'DD+': ['eac3'],
  TrueHD: ['truehd'],
  DTS: ['dts'],
  'DTS-ES': ['dts'],
  'DTS-HD': ['dtshd', 'dts'],
  'DTS-HD MA': ['dtshd', 'dts'],
  'DTS:X': ['dtsx', 'dtshd', 'dts'],
};

const HDR10_LAYER_TAGS = ['HDR10', 'HDR'];

function videoPlayable(stream: ParsedStream, caps: DeviceCapabilities) {
  if (!caps.video) return true;
  const codec = ENCODE_TO_CODEC[stream.parsedFile?.encode ?? ''];
  return codec === undefined || caps.video.includes(codec);
}

/**
 * A stream plays if any of its dynamic range layers does: DV with an HDR10 or
 * HLG base layer falls back to that layer on a device without DV. A DV-only
 * file (in practice profile 5) needs a device that lists profile 5.
 */
function dynamicRangePlayable(stream: ParsedStream, caps: DeviceCapabilities) {
  const tags = stream.parsedFile?.visualTags ?? [];
  const hasDv = tags.includes('DV');
  const hasHdr10Plus = tags.includes('HDR10+');
  const hasHdr10 = tags.some((t) => HDR10_LAYER_TAGS.includes(t));
  const hasHlg = tags.includes('HLG');
  const hasBaseLayer = hasHdr10Plus || hasHdr10 || hasHlg;

  if (!hasDv && !hasBaseLayer) return true; // SDR or untagged

  const hdr = caps.hdr;
  const layers: boolean[] = [];
  if (hasDv) {
    layers.push(
      caps.dv === undefined ||
        (hasBaseLayer
          ? caps.dv.includes('7') || caps.dv.includes('8')
          : caps.dv.includes('5'))
    );
  }
  if (hasHdr10Plus) {
    layers.push(
      hdr === undefined || hdr.includes('hdr10plus') || hdr.includes('hdr10')
    );
  }
  if (hasHdr10) layers.push(hdr === undefined || hdr.includes('hdr10'));
  if (hasHlg) layers.push(hdr === undefined || hdr.includes('hlg'));
  return layers.some(Boolean);
}

/** Plays if any known audio format on the stream does; unknown ones are ignored. */
function audioPlayable(stream: ParsedStream, caps: DeviceCapabilities) {
  if (!caps.audio) return true;
  const known = (stream.parsedFile?.audioTags ?? [])
    .map((tag) => AUDIO_TAG_TO_CODECS[tag])
    .filter((codecs): codecs is DeviceAudioCodec[] => codecs !== undefined);
  if (known.length === 0) return true;
  return known.some((codecs) => codecs.some((c) => caps.audio!.includes(c)));
}

function resolutionPlayable(stream: ParsedStream, caps: DeviceCapabilities) {
  if (caps.maxres === undefined) return true;
  const match = /^(\d+)p$/.exec(stream.parsedFile?.resolution ?? '');
  return !match || Number(match[1]) <= caps.maxres;
}

/** The reasons a stream won't play on the device; empty when it will. */
export function getUnplayableReasons(
  stream: ParsedStream,
  caps: DeviceCapabilities
): UnplayableReason[] {
  if (!stream.parsedFile) return [];
  const reasons: UnplayableReason[] = [];
  if (!videoPlayable(stream, caps)) reasons.push('video');
  if (!dynamicRangePlayable(stream, caps)) reasons.push('dynamicRange');
  if (!audioPlayable(stream, caps)) reasons.push('audio');
  if (!resolutionPlayable(stream, caps)) reasons.push('resolution');
  return reasons;
}

export function isPlayableOnDevice(
  stream: ParsedStream,
  caps: DeviceCapabilities
): boolean {
  return getUnplayableReasons(stream, caps).length === 0;
}

/**
 * Returns a new list with unplayable streams moved to the end (keeping their
 * order) or removed. The input array and its streams are left untouched.
 */
export function applyDeviceCapabilities(
  streams: ParsedStream[],
  caps: DeviceCapabilities | undefined,
  mode: DeviceCapabilitiesMode | undefined
): { streams: ParsedStream[]; unplayable: number } {
  if (!caps || !mode || mode === 'off') {
    return { streams, unplayable: 0 };
  }
  const playable: ParsedStream[] = [];
  const unplayable: ParsedStream[] = [];
  for (const stream of streams) {
    (isPlayableOnDevice(stream, caps) ? playable : unplayable).push(stream);
  }
  return {
    streams: mode === 'exclude' ? playable : [...playable, ...unplayable],
    unplayable: unplayable.length,
  };
}
