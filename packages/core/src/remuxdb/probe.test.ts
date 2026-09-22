import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  toTrackPayload,
  hdr10PlusStreamIndexes,
  type FfprobeStream,
} from './probe.js';

// Captured verbatim from a real `ffprobe -show_format -show_streams
// -show_frames -read_intervals "%+#5"` run against a small ffmpeg-generated
// test.mkv (h264 video + aac audio).
const videoStream: FfprobeStream = {
  index: 0,
  codec_name: 'h264',
  profile: 'High',
  codec_type: 'video',
  codec_tag_string: '[0][0][0][0]',
  width: 320,
  height: 240,
  display_aspect_ratio: '4:3',
  pix_fmt: 'yuv420p',
  color_range: 'tv',
  level: 13,
  field_order: 'progressive',
  refs: 4,
  r_frame_rate: '10/1',
  avg_frame_rate: '10/1',
  bits_per_raw_sample: '8',
  disposition: {
    default: 0,
    forced: 0,
    hearing_impaired: 0,
    visual_impaired: 0,
  },
  tags: { language: 'eng' },
};

const audioStream: FfprobeStream = {
  index: 1,
  codec_name: 'aac',
  profile: 'LC',
  codec_type: 'audio',
  codec_tag_string: '[0][0][0][0]',
  sample_rate: '48000',
  channels: 2,
  channel_layout: 'stereo',
  disposition: {
    default: 0,
    forced: 0,
    hearing_impaired: 0,
    visual_impaired: 0,
  },
  tags: { language: 'eng', title: 'English' },
};

describe('toTrackPayload', () => {
  it('maps a video stream', () => {
    const track = toTrackPayload(videoStream, {
      refsByIndex: new Map([[videoStream.index, 4]]),
      hdr10PlusIndexes: new Set(),
    });
    assert.equal(track?.kind, 'video');
    assert.equal(track?.codec, 'h264');
    if (track?.kind !== 'video') return;
    assert.equal(track.width, 320);
    assert.equal(track.height, 240);
    assert.equal(track.fps, 10);
    assert.equal(track.pixel_format, 'yuv420p');
    assert.equal(track.aspect_ratio, '4:3');
    assert.equal(track.language, 'eng');
    assert.equal(track.level, 13);
    assert.equal(track.is_interlaced, false);
    assert.equal(track.ref_frames, 4);
    assert.equal(track.codec_tag, undefined);
  });

  it('keeps a real codec tag (e.g. from an MP4 source)', () => {
    const track = toTrackPayload({ ...videoStream, codec_tag_string: 'avc1' });
    assert.equal(track?.kind, 'video');
    if (track?.kind !== 'video') return;
    assert.equal(track.codec_tag, 'avc1');
  });

  it('finds the HDR10+ stream index from real ffprobe frame side data', () => {
    // ffprobe's frame-level side_data_type name (av_frame_side_data_name)
    // differs from the stream-level one (av_packet_side_data_name).
    const indexes = hdr10PlusStreamIndexes([
      {
        stream_index: 0,
        side_data_list: [
          { side_data_type: 'HDR Dynamic Metadata SMPTE2094-40 (HDR10+)' },
        ],
      },
    ]);
    assert.deepEqual(indexes, new Set([0]));
  });

  it('flags an HDR10+ track from a matching sampled frame', () => {
    const track = toTrackPayload(videoStream, {
      refsByIndex: new Map(),
      hdr10PlusIndexes: new Set([videoStream.index]),
    });
    assert.equal(track?.kind, 'video');
    if (track?.kind !== 'video') return;
    assert.equal(track.hdr10_plus_present, true);
  });

  it('leaves hdr10_plus_present unset without a matching sampled frame', () => {
    const track = toTrackPayload(videoStream, {
      refsByIndex: new Map(),
      hdr10PlusIndexes: new Set(),
    });
    assert.equal(track?.kind, 'video');
    if (track?.kind !== 'video') return;
    assert.equal(track.hdr10_plus_present, false);
  });

  it('maps an audio stream', () => {
    const track = toTrackPayload(audioStream);
    assert.equal(track?.kind, 'audio');
    if (track?.kind !== 'audio') return;
    assert.equal(track.codec, 'aac');
    assert.equal(track.channels, 2);
    assert.equal(track.sample_rate, 48000);
    assert.equal(track.channel_layout, 'stereo');
    assert.equal(track.title, 'English');
  });

  it('returns undefined for an unrecognised stream type', () => {
    assert.equal(
      toTrackPayload({ index: 2, codec_type: 'data' } as FfprobeStream),
      undefined
    );
  });
});
