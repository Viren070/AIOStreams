import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  configReadsDevice,
  deviceCapabilitiesFingerprint,
  deviceExpressionConstants,
  parseDeviceCapabilities,
} from './device-capabilities.js';

describe('parseDeviceCapabilities', () => {
  it('parses the spec example', () => {
    assert.deepEqual(
      parseDeviceCapabilities(
        'v=1; video=h264,hevc; hdr=hdr10,hlg; dv=8; audio=ac3,eac3; maxres=2160'
      ),
      {
        version: 1,
        video: ['h264', 'hevc'],
        hdr: ['hdr10', 'hlg'],
        dv: ['8'],
        audio: ['ac3', 'eac3'],
        maxres: 2160,
      }
    );
  });

  it('returns undefined for a missing or blank header', () => {
    assert.equal(parseDeviceCapabilities(undefined), undefined);
    assert.equal(parseDeviceCapabilities(null), undefined);
    assert.equal(parseDeviceCapabilities(''), undefined);
    assert.equal(parseDeviceCapabilities('   '), undefined);
  });

  it('leaves missing keys unknown', () => {
    assert.deepEqual(parseDeviceCapabilities('v=1; dv=none'), {
      version: 1,
      dv: [],
    });
  });

  it('treats none as explicitly unsupported', () => {
    const caps = parseDeviceCapabilities('hdr=none; dv=none; video=none');
    assert.deepEqual(caps?.hdr, []);
    assert.deepEqual(caps?.dv, []);
    assert.deepEqual(caps?.video, []);
  });

  it('drops unknown keys and values without erroring', () => {
    assert.deepEqual(
      parseDeviceCapabilities('v=1; video=hevc,mpeg2,AV1; foo=bar; colour=yes'),
      { version: 1, video: ['hevc', 'av1'] }
    );
  });

  it('keeps a key unknown when none of its values are known', () => {
    assert.deepEqual(parseDeviceCapabilities('video=mpeg2,vc1'), {
      version: 1,
    });
  });

  it('prefers known values over none in a mixed list', () => {
    assert.deepEqual(parseDeviceCapabilities('dv=none,8')?.dv, ['8']);
  });

  it('is case and whitespace tolerant', () => {
    assert.deepEqual(
      parseDeviceCapabilities('  V = 1 ;VIDEO= H264 , HEVC ;  MaxRes=1080p '),
      { version: 1, video: ['h264', 'hevc'], maxres: 1080 }
    );
  });

  it('normalises DV sub-profiles and dedupes', () => {
    assert.deepEqual(parseDeviceCapabilities('dv=8.1,8.4,7,7')?.dv, ['8', '7']);
  });

  it('ignores malformed pairs', () => {
    assert.deepEqual(
      parseDeviceCapabilities(';;=hevc; video; audio=; ===; dv=5;'),
      { version: 1, dv: ['5'] }
    );
  });

  it('ignores an unreadable version and keeps newer ones', () => {
    assert.equal(parseDeviceCapabilities('v=abc; dv=5')?.version, 1);
    assert.equal(parseDeviceCapabilities('v=-2; dv=5')?.version, 1);
    assert.equal(parseDeviceCapabilities('v=2; dv=5; newkey=x')?.version, 2);
  });

  it('rejects nonsense resolutions', () => {
    assert.equal(parseDeviceCapabilities('maxres=4k')?.maxres, undefined);
    assert.equal(parseDeviceCapabilities('maxres=99999')?.maxres, undefined);
    assert.equal(parseDeviceCapabilities('maxres=none')?.maxres, undefined);
    assert.equal(parseDeviceCapabilities('maxres=720')?.maxres, 720);
  });

  it('uses the first occurrence of a repeated key', () => {
    assert.deepEqual(parseDeviceCapabilities('dv=none; dv=5')?.dv, []);
  });

  it('joins repeated headers', () => {
    assert.deepEqual(parseDeviceCapabilities(['video=hevc', 'dv=none']), {
      version: 1,
      video: ['hevc'],
      dv: [],
    });
  });

  it('survives an oversized header', () => {
    const caps = parseDeviceCapabilities(
      'dv=none;' + 'x=' + 'a'.repeat(10_000)
    );
    assert.deepEqual(caps, { version: 1, dv: [] });
  });
});

describe('deviceExpressionConstants', () => {
  it('reads as no device and fully supported without a header', () => {
    const c = deviceExpressionConstants(undefined);
    assert.equal(c['device.present'], false);
    assert.deepEqual(c['device.keys'], []);
    assert.deepEqual(c['device.dv'], ['5', '7', '8']);
    assert.equal(c['device.maxres'], 4320);
  });

  it('exposes the sent keys and values', () => {
    const c = deviceExpressionConstants(
      parseDeviceCapabilities('dv=none; video=hevc; maxres=1080')
    );
    assert.equal(c['device.present'], true);
    assert.equal(c['device.version'], 1);
    assert.deepEqual(c['device.keys'], ['video', 'dv', 'maxres']);
    assert.deepEqual(c['device.dv'], []);
    assert.deepEqual(c['device.video'], ['hevc']);
    assert.deepEqual(c['device.hdr'], ['hdr10', 'hdr10plus', 'hlg']);
    assert.equal(c['device.maxres'], 1080);
  });
});

describe('configReadsDevice', () => {
  it('spots device.* in expressions', () => {
    assert.equal(
      configReadsDevice(
        '{"excludedStreamExpressions":[{"expression":"\'5\' in device.dv"}]}'
      ),
      true
    );
    assert.equal(configReadsDevice('device.maxres < 2160'), true);
  });

  it('ignores other uses of the word', () => {
    assert.equal(configReadsDevice('{"addonName":"My device addon"}'), false);
    assert.equal(configReadsDevice('mydevice.dv'), false);
    assert.equal(configReadsDevice('device.colour'), false);
  });
});

describe('deviceCapabilitiesFingerprint', () => {
  it('is the same for headers that mean the same thing', () => {
    const a = parseDeviceCapabilities('video=hevc,h264; dv=none')!;
    const b = parseDeviceCapabilities('DV=none;video=h264, hevc ; foo=1')!;
    assert.equal(
      deviceCapabilitiesFingerprint(a),
      deviceCapabilitiesFingerprint(b)
    );
  });

  it('tells unknown apart from none', () => {
    const unknown = parseDeviceCapabilities('video=hevc')!;
    const none = parseDeviceCapabilities('video=hevc; dv=none')!;
    assert.notEqual(
      deviceCapabilitiesFingerprint(unknown),
      deviceCapabilitiesFingerprint(none)
    );
  });
});
