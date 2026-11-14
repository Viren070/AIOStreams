import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ParsedStream, UserData } from '../db/schemas.js';
import type { DeviceCapabilities } from '../utils/device-capabilities.js';
import StreamDeduplicator from './deduplicator.js';
import { parseDeviceCapabilities } from '../utils/device-capabilities.js';
import {
  applyDeviceCapabilities,
  deduplicateForDevice,
  type DeviceCapabilitiesMode,
  getUnplayableReasons,
  playChainScope,
} from './device-capabilities.js';

function stream(
  id: string,
  file: {
    resolution?: string;
    encode?: string;
    visualTags?: string[];
    audioTags?: string[];
  } = {}
): ParsedStream {
  return {
    id,
    type: 'debrid',
    addon: { name: 'Test', manifestUrl: 'https://example.test/manifest.json' },
    parsedFile: {
      resolution: file.resolution,
      encode: file.encode,
      visualTags: file.visualTags ?? [],
      audioTags: file.audioTags ?? [],
      audioChannels: [],
      languages: [],
    },
  } as unknown as ParsedStream;
}

const caps = (header: string) => parseDeviceCapabilities(header)!;

// A TV with HDR10 but no Dolby Vision, like the one that prompted this.
const tvWithoutDv = caps('v=1; video=h264,hevc; hdr=hdr10; dv=none');

describe('getUnplayableReasons: Dolby Vision', () => {
  it('rejects DV-only on a device without DV', () => {
    assert.deepEqual(
      getUnplayableReasons(stream('a', { visualTags: ['DV'] }), tvWithoutDv),
      ['dynamicRange']
    );
  });

  it('accepts DV with an HDR10 layer on a device without DV', () => {
    for (const base of ['HDR10', 'HDR10+', 'HDR']) {
      assert.deepEqual(
        getUnplayableReasons(
          stream('a', { visualTags: ['DV', base] }),
          tvWithoutDv
        ),
        [],
        base
      );
    }
  });

  it('accepts DV with an HLG layer only if the device has HLG', () => {
    const s = stream('a', { visualTags: ['DV', 'HLG'] });
    assert.deepEqual(getUnplayableReasons(s, tvWithoutDv), ['dynamicRange']);
    assert.deepEqual(getUnplayableReasons(s, caps('dv=none; hdr=hlg')), []);
  });

  it('accepts DV-only only on devices that list profile 5', () => {
    const s = stream('a', { visualTags: ['DV'] });
    assert.deepEqual(getUnplayableReasons(s, caps('dv=5,8')), []);
    assert.deepEqual(getUnplayableReasons(s, caps('dv=8')), ['dynamicRange']);
  });

  it('plays DV+HDR10 through DV even when HDR10 is unsupported', () => {
    const s = stream('a', { visualTags: ['DV', 'HDR10'] });
    assert.deepEqual(getUnplayableReasons(s, caps('dv=8; hdr=none')), []);
    assert.deepEqual(getUnplayableReasons(s, caps('dv=none; hdr=none')), [
      'dynamicRange',
    ]);
  });

  it('never filters DV when the dv key is missing', () => {
    assert.deepEqual(
      getUnplayableReasons(
        stream('a', { visualTags: ['DV'] }),
        caps('hdr=none')
      ),
      []
    );
  });
});

describe('getUnplayableReasons: HDR', () => {
  it('lets HDR10+ fall back to HDR10', () => {
    assert.deepEqual(
      getUnplayableReasons(
        stream('a', { visualTags: ['HDR10+'] }),
        caps('hdr=hdr10')
      ),
      []
    );
  });

  it('rejects HDR on an SDR-only device', () => {
    assert.deepEqual(
      getUnplayableReasons(
        stream('a', { visualTags: ['HDR'] }),
        caps('hdr=none')
      ),
      ['dynamicRange']
    );
  });

  it('always plays SDR and untagged streams', () => {
    const sdrOnly = caps('hdr=none; dv=none');
    assert.deepEqual(getUnplayableReasons(stream('a'), sdrOnly), []);
    assert.deepEqual(
      getUnplayableReasons(
        stream('a', { visualTags: ['SDR', '10bit'] }),
        sdrOnly
      ),
      []
    );
  });
});

describe('getUnplayableReasons: video codec', () => {
  it('rejects AV1 on a device without AV1', () => {
    assert.deepEqual(
      getUnplayableReasons(stream('a', { encode: 'AV1' }), tvWithoutDv),
      ['video']
    );
  });

  it('accepts AV1 when listed', () => {
    assert.deepEqual(
      getUnplayableReasons(stream('a', { encode: 'AV1' }), caps('video=av1')),
      []
    );
  });

  it('maps AVC to h264', () => {
    assert.deepEqual(
      getUnplayableReasons(stream('a', { encode: 'AVC' }), caps('video=hevc')),
      ['video']
    );
    assert.deepEqual(
      getUnplayableReasons(stream('a', { encode: 'AVC' }), caps('video=h264')),
      []
    );
  });

  it('never filters encodes the spec has no key for', () => {
    for (const encode of ['VC-1', 'XviD', 'Unknown', undefined]) {
      assert.deepEqual(
        getUnplayableReasons(stream('a', { encode }), caps('video=none')),
        [],
        String(encode)
      );
    }
  });

  it('never filters video when the video key is missing', () => {
    assert.deepEqual(
      getUnplayableReasons(stream('a', { encode: 'AV1' }), caps('dv=none')),
      []
    );
  });
});

describe('getUnplayableReasons: audio', () => {
  const ac3Only = caps('audio=aac,ac3');

  it('rejects a stream whose only audio is unsupported', () => {
    assert.deepEqual(
      getUnplayableReasons(
        stream('a', { audioTags: ['TrueHD', 'Atmos'] }),
        ac3Only
      ),
      ['audio']
    );
  });

  it('accepts a stream with at least one supported track', () => {
    assert.deepEqual(
      getUnplayableReasons(
        stream('a', { audioTags: ['TrueHD', 'DD'] }),
        ac3Only
      ),
      []
    );
  });

  it('lets DTS-HD and DTS:X fall back to the DTS core', () => {
    const dtsOnly = caps('audio=dts');
    for (const tag of ['DTS-HD MA', 'DTS-HD', 'DTS:X', 'DTS-ES']) {
      assert.deepEqual(
        getUnplayableReasons(stream('a', { audioTags: [tag] }), dtsOnly),
        [],
        tag
      );
    }
  });

  it('does not treat DD+ as playable on an AC3-only device', () => {
    assert.deepEqual(
      getUnplayableReasons(stream('a', { audioTags: ['DD+'] }), ac3Only),
      ['audio']
    );
  });

  it('ignores audio formats the spec has no key for', () => {
    assert.deepEqual(
      getUnplayableReasons(
        stream('a', { audioTags: ['FLAC', 'OPUS', 'Unknown'] }),
        caps('audio=none')
      ),
      []
    );
  });
});

describe('getUnplayableReasons: resolution', () => {
  it('rejects resolutions above maxres', () => {
    assert.deepEqual(
      getUnplayableReasons(
        stream('a', { resolution: '2160p' }),
        caps('maxres=1080')
      ),
      ['resolution']
    );
  });

  it('accepts resolutions at or below maxres and unknown ones', () => {
    const fhd = caps('maxres=1080');
    for (const resolution of ['1080p', '720p', 'Unknown', undefined]) {
      assert.deepEqual(
        getUnplayableReasons(stream('a', { resolution }), fhd),
        [],
        String(resolution)
      );
    }
  });
});

describe('getUnplayableReasons: several reasons', () => {
  it('reports each failing check', () => {
    assert.deepEqual(
      getUnplayableReasons(
        stream('a', {
          resolution: '2160p',
          encode: 'AV1',
          visualTags: ['DV'],
          audioTags: ['TrueHD'],
        }),
        caps('video=hevc; dv=none; audio=ac3; maxres=1080')
      ),
      ['video', 'dynamicRange', 'audio', 'resolution']
    );
  });

  it('accepts a stream without parsed file info', () => {
    const s = { ...stream('a'), parsedFile: undefined } as ParsedStream;
    assert.deepEqual(getUnplayableReasons(s, tvWithoutDv), []);
  });
});

describe('applyDeviceCapabilities', () => {
  const list = [
    stream('dv-only', { visualTags: ['DV'] }),
    stream('dv-hdr', { visualTags: ['DV', 'HDR10'] }),
    stream('av1', { encode: 'AV1' }),
    stream('sdr'),
  ];

  it('changes nothing without a header', () => {
    for (const mode of ['off', 'deprioritise', 'exclude'] as const) {
      const result = applyDeviceCapabilities(list, undefined, mode);
      assert.equal(result.streams, list);
      assert.equal(result.unplayable, 0);
    }
  });

  it('changes nothing when the option is off or unset', () => {
    assert.equal(
      applyDeviceCapabilities(list, tvWithoutDv, 'off').streams,
      list
    );
    assert.equal(
      applyDeviceCapabilities(list, tvWithoutDv, undefined).streams,
      list
    );
  });

  it('pushes unplayable streams to the bottom, keeping order', () => {
    const result = applyDeviceCapabilities(list, tvWithoutDv, 'deprioritise');
    assert.deepEqual(
      result.streams.map((s) => s.id),
      ['dv-hdr', 'sdr', 'dv-only', 'av1']
    );
    assert.equal(result.unplayable, 2);
  });

  it('excludes unplayable streams', () => {
    const result = applyDeviceCapabilities(list, tvWithoutDv, 'exclude');
    assert.deepEqual(
      result.streams.map((s) => s.id),
      ['dv-hdr', 'sdr']
    );
  });

  it('keeps everything for a header with no known keys', () => {
    const result = applyDeviceCapabilities(
      list,
      caps('v=1; foo=bar'),
      'exclude'
    );
    assert.deepEqual(
      result.streams.map((s) => s.id),
      list.map((s) => s.id)
    );
  });

  it('does not mutate the input list', () => {
    const before = list.map((s) => s.id);
    applyDeviceCapabilities(list, tvWithoutDv, 'exclude');
    assert.deepEqual(
      list.map((s) => s.id),
      before
    );
  });
});

describe('exclude before deduplication', () => {
  const tv = caps('v=1; video=h264,hevc; hdr=hdr10; dv=none');
  const phone = caps('v=1; video=h264,hevc; hdr=hdr10; dv=5,8');

  // Two releases of one file, so the deduplicator keeps one per group. The
  // DV-only copy comes first and would win the group if it took part.
  const group = () => [
    {
      ...stream('dv-only', { visualTags: ['DV'] }),
      filename: 'Film.mkv',
      type: 'p2p' as const,
    },
    {
      ...stream('hdr10', { visualTags: ['HDR10'] }),
      filename: 'Film.mkv',
      type: 'p2p' as const,
    },
  ];

  async function dedupFor(
    device: DeviceCapabilities,
    mode: DeviceCapabilitiesMode = 'exclude'
  ) {
    const deduplicator = new StreamDeduplicator({
      deduplicator: {
        enabled: true,
        keys: ['filename'],
        p2p: 'single_result',
      },
      presets: [],
      services: [],
    } as unknown as UserData);
    const result = await deduplicateForDevice(
      group(),
      (streams) => deduplicator.deduplicate(streams),
      device,
      mode
    );
    return result.streams.map((s) => s.id);
  }

  it('keeps the playable duplicate for a device that cannot play the other', async () => {
    assert.deepEqual(await dedupFor(tv), ['hdr10']);
  });

  it('still dedupes to one stream for a device that plays both', async () => {
    assert.equal((await dedupFor(phone)).length, 1);
  });

  it('leaves dedup alone when the mode is not exclude', async () => {
    assert.deepEqual(await dedupFor(tv, 'deprioritise'), ['dv-only']);
  });

  it('gives each device its own chain scope only in exclude mode', () => {
    const hash = (s: string) => `h(${s})`;
    assert.notEqual(
      playChainScope('user', tv, 'exclude', hash),
      playChainScope('user', phone, 'exclude', hash)
    );
    assert.equal(playChainScope('user', tv, 'deprioritise', hash), 'user');
    assert.equal(playChainScope('user', undefined, 'exclude', hash), 'user');
  });
});
