import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ParsedFile } from '../db/schemas.js';
import { directPlayable } from './device-profile.js';
import { offeredSources } from './media.js';
import type { DeviceProfile, MediaSourceRecord } from './types.js';

function makeSource(
  msid: string,
  overrides: {
    container?: string;
    parsedFile?: Partial<ParsedFile>;
    bitrate?: number;
    notice?: boolean;
    needs?: MediaSourceRecord['needs'];
  } = {}
): MediaSourceRecord {
  return {
    msid,
    url: `https://example.com/${msid}`,
    container: overrides.container ?? 'mkv',
    bitrate: overrides.bitrate,
    label: msid,
    parsedFile: overrides.parsedFile as ParsedFile | undefined,
    subtitles: [],
    live: false,
    notice: overrides.notice,
    needs: overrides.needs,
    extension: {
      name: msid,
      description: '',
      addon: 'test',
      visualTags: [],
      audioTags: [],
      audioChannels: [],
      languages: [],
      type: 'debrid',
    },
  };
}

const SAFARI_PROFILE: DeviceProfile = {
  DirectPlayProfiles: [
    {
      Type: 'Video',
      Container: 'mp4,m4v,mov',
      VideoCodec: 'h264',
      AudioCodec: 'aac,mp3,ac3,eac3',
    },
  ],
};

const BROWSER_PROFILE: DeviceProfile = {
  DirectPlayProfiles: [
    {
      Type: 'Video',
      Container: 'mp4,m4v,mov',
      VideoCodec: 'h264,hevc,av1',
      AudioCodec: 'aac,mp3,opus,flac',
    },
    {
      Type: 'Video',
      Container: 'webm',
      VideoCodec: 'vp8,vp9,av1',
      AudioCodec: 'opus,vorbis',
    },
    {
      Type: 'Video',
      Container: 'mkv',
      VideoCodec: 'h264,hevc,av1',
      AudioCodec: 'aac,mp3,opus,flac',
    },
  ],
};

describe('directPlayable', () => {
  it('returns true when profile is absent or has no Video DirectPlayProfiles', () => {
    const hevcTrueHd = makeSource('a', {
      container: 'mkv',
      parsedFile: { encode: 'HEVC', audioTags: ['TrueHD'] },
    });
    assert.equal(directPlayable(hevcTrueHd, undefined), true);
    assert.equal(directPlayable(hevcTrueHd, {}), true);
    assert.equal(directPlayable(hevcTrueHd, { DirectPlayProfiles: [] }), true);
    assert.equal(
      directPlayable(hevcTrueHd, {
        DirectPlayProfiles: [{ Type: 'Audio', Container: 'mp3' }],
      }),
      true
    );
  });

  it('matches everything for wildcard Video profile (e.g. mpv/own-player)', () => {
    const mpvProfile: DeviceProfile = {
      DirectPlayProfiles: [{ Type: 'Video' }],
    };
    const remux = makeSource('remux', {
      container: 'mkv',
      parsedFile: { encode: 'HEVC', audioTags: ['TrueHD', 'DTS-HD MA'] },
    });
    assert.equal(directPlayable(remux, mpvProfile), true);
  });

  it('checks container, video codec, and audio codec against DirectPlayProfiles', () => {
    const mp4H264Aac = makeSource('ok', {
      container: 'mp4',
      parsedFile: { encode: 'AVC', audioTags: ['AAC'] },
    });
    const mkvH264Aac = makeSource('mkv', {
      container: 'mkv',
      parsedFile: { encode: 'AVC', audioTags: ['AAC'] },
    });
    const mp4HevcAac = makeSource('hevc', {
      container: 'mp4',
      parsedFile: { encode: 'HEVC', audioTags: ['AAC'] },
    });
    const mp4H264TrueHd = makeSource('truehd', {
      container: 'mp4',
      parsedFile: { encode: 'AVC', audioTags: ['TrueHD'] },
    });

    assert.equal(directPlayable(mp4H264Aac, SAFARI_PROFILE), true);
    assert.equal(directPlayable(mkvH264Aac, SAFARI_PROFILE), false);
    assert.equal(directPlayable(mp4HevcAac, SAFARI_PROFILE), false);
    assert.equal(directPlayable(mp4H264TrueHd, SAFARI_PROFILE), false);
  });

  it('does not mix container and codec across different DirectPlayProfiles entries', () => {
    const mp4H264Opus = makeSource('mp4-ok', {
      container: 'mp4',
      parsedFile: { encode: 'AVC', audioTags: ['OPUS'] },
    });
    const webmAv1Opus = makeSource('webm-ok', {
      container: 'webm',
      parsedFile: { encode: 'AV1', audioTags: ['OPUS'] },
    });
    const webmHevcAac = makeSource('webm-bad', {
      container: 'webm',
      parsedFile: { encode: 'HEVC', audioTags: ['AAC'] },
    });

    assert.equal(directPlayable(mp4H264Opus, BROWSER_PROFILE), true);
    assert.equal(directPlayable(webmAv1Opus, BROWSER_PROFILE), true);
    assert.equal(directPlayable(webmHevcAac, BROWSER_PROFILE), false);
  });

  it('allows a file when at least one of its audio tags is supported', () => {
    const ddpAtmos = makeSource('ddp-atmos', {
      container: 'mp4',
      parsedFile: { encode: 'AVC', audioTags: ['DD+', 'Atmos'] },
    });
    const dtsOnly = makeSource('dts-only', {
      container: 'mp4',
      parsedFile: { encode: 'AVC', audioTags: ['DTS-HD MA'] },
    });

    assert.equal(directPlayable(ddpAtmos, SAFARI_PROFILE), true);
    assert.equal(directPlayable(dtsOnly, SAFARI_PROFILE), false);
  });

  it('uses probed audioTracks when present and leans playable if any track codec is unknown', () => {
    const probedDual = makeSource('probed-dual', {
      container: 'mkv',
      parsedFile: {
        encode: 'HEVC',
        audioTags: ['TrueHD'],
        audioTracks: [{ codec: 'truehd' }, { codec: 'aac' }],
      },
    });
    const probedTrueHdOnly = makeSource('probed-truehd', {
      container: 'mkv',
      parsedFile: {
        encode: 'HEVC',
        audioTracks: [{ codec: 'truehd' }, { codec: 'dts' }],
      },
    });
    const probedUnknownTrack = makeSource('probed-unknown', {
      container: 'mkv',
      parsedFile: {
        encode: 'HEVC',
        audioTracks: [{ codec: 'truehd' }, {}],
      },
    });

    assert.equal(directPlayable(probedDual, BROWSER_PROFILE), true);
    assert.equal(directPlayable(probedTrueHdOnly, BROWSER_PROFILE), false);
    assert.equal(directPlayable(probedUnknownTrack, BROWSER_PROFILE), true);
  });

  it('leans towards playable for unknown encode, audio tags, or missing container', () => {
    const unknownAll = makeSource('unknown', {
      container: '',
      parsedFile: { encode: 'Unknown', audioTags: ['Unknown'] },
    });
    const noParsedFile = makeSource('no-pf', {
      container: 'mp4',
      parsedFile: undefined,
    });

    assert.equal(directPlayable(unknownAll, SAFARI_PROFILE), true);
    assert.equal(directPlayable(noParsedFile, SAFARI_PROFILE), true);
  });

  it('normalizes common Jellyfin container and codec aliases', () => {
    const aliasProfile: DeviceProfile = {
      DirectPlayProfiles: [
        {
          Type: 'Video',
          Container: 'matroska,mpegts',
          VideoCodec: 'h265,avc',
          AudioCodec: 'dca,ec-3,ac-3',
        },
      ],
    };
    const mkvHevcDts = makeSource('alias1', {
      container: 'mkv',
      parsedFile: { encode: 'HEVC', audioTags: ['DTS'] },
    });
    const tsAvcDdp = makeSource('alias2', {
      container: 'ts',
      parsedFile: { encode: 'AVC', audioTags: ['DD+'] },
    });

    assert.equal(directPlayable(mkvHevcDts, aliasProfile), true);
    assert.equal(directPlayable(tsAvcDdp, aliasProfile), true);
  });

  it('enforces MaxStreamingBitrate when both profile cap and record bitrate are present', () => {
    const cappedProfile: DeviceProfile = {
      MaxStreamingBitrate: 10_000_000,
      DirectPlayProfiles: [{ Type: 'Video' }],
    };
    const highBitrate = makeSource('high', { bitrate: 25_000_000 });
    const okBitrate = makeSource('ok', { bitrate: 10_000_000 });
    const unknownBitrate = makeSource('unknown', { bitrate: undefined });

    assert.equal(directPlayable(highBitrate, cappedProfile), false);
    assert.equal(directPlayable(okBitrate, cappedProfile), true);
    assert.equal(directPlayable(unknownBitrate, cappedProfile), true);
  });
});

describe('offeredSources with device profile', () => {
  const s1 = makeSource('1-mkv-hevc', {
    container: 'mkv',
    parsedFile: { encode: 'HEVC', audioTags: ['TrueHD'] },
  });
  const s2 = makeSource('2-mp4-h264', {
    container: 'mp4',
    parsedFile: { encode: 'AVC', audioTags: ['AAC'] },
  });
  const s3 = makeSource('3-mkv-dts', {
    container: 'mkv',
    parsedFile: { encode: 'AVC', audioTags: ['DTS'] },
  });
  const s4 = makeSource('4-mp4-ddp', {
    container: 'mp4',
    parsedFile: { encode: 'AVC', audioTags: ['DD+'] },
  });
  const notice = makeSource('notice', { notice: true });

  it('keeps original order when mode is off or omitted', () => {
    const off = offeredSources([s1, s2, s3, s4, notice], {}, 10, {
      profile: SAFARI_PROFILE,
      mode: 'off',
    });
    assert.deepEqual(
      off.map((s) => s.msid),
      ['1-mkv-hevc', '2-mp4-h264', '3-mkv-dts', '4-mp4-ddp', 'notice']
    );
  });

  it('deprioritises unplayable versions in order before applying max limit', () => {
    const all = offeredSources([s1, s2, s3, s4, notice], {}, 10, {
      profile: SAFARI_PROFILE,
      mode: 'deprioritise',
    });
    assert.deepEqual(
      all.map((s) => s.msid),
      ['2-mp4-h264', '4-mp4-ddp', '1-mkv-hevc', '3-mkv-dts', 'notice']
    );

    const limited = offeredSources([s1, s2, s3, s4, notice], {}, 2, {
      profile: SAFARI_PROFILE,
      mode: 'deprioritise',
    });
    assert.deepEqual(
      limited.map((s) => s.msid),
      ['2-mp4-h264', '4-mp4-ddp', 'notice']
    );
  });

  it('excludes unplayable versions before applying max limit', () => {
    const excluded = offeredSources([s1, s2, s3, s4, notice], {}, 2, {
      profile: SAFARI_PROFILE,
      mode: 'exclude',
    });
    assert.deepEqual(
      excluded.map((s) => s.msid),
      ['2-mp4-h264', '4-mp4-ddp', 'notice']
    );
  });

  it('returns empty array when exclude drops every playable version and there are no notices', () => {
    const excluded = offeredSources([s1, s3], {}, 10, {
      profile: SAFARI_PROFILE,
      mode: 'exclude',
    });
    assert.deepEqual(excluded, []);
  });

  it('is a no-op when profile is undefined even if mode is active', () => {
    const res = offeredSources([s1, s2], {}, 10, {
      profile: undefined,
      mode: 'exclude',
    });
    assert.deepEqual(
      res.map((s) => s.msid),
      ['1-mkv-hevc', '2-mp4-h264']
    );
  });
});
