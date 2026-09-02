import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { stripProviderResidue } from './providerResidue.js';

describe('stripProviderResidue', () => {
  it('strips bitrate-marker residue glued to the extension (4KHDHub bluray)', () => {
    assert.equal(
      stripProviderResidue(
        'Reacher.S01E01.UHD.BluRay.2160p.10bit.HEVC.HDR.[Hindi.DDP5.1.+.English.DTS-HD.MA.5.1].(HDS-Ionicboy).mkv4KMKVBluRayHDR10+10BitHEVCDdp5.1~26.2Mbps4kmkvblurayhdr10+10bithevcdp5.1~26.2mbps.pad-4KHDHub'
      ),
      'Reacher.S01E01.UHD.BluRay.2160p.10bit.HEVC.HDR.[Hindi.DDP5.1.+.English.DTS-HD.MA.5.1].(HDS-Ionicboy).mkv'
    );
  });

  it('strips residue with bitrate and .pad- suffix (2Peckle form)', () => {
    assert.equal(
      stripProviderResidue(
        'Reacher.S01E01.1080p.AMZN.WEB-DL.DDP5.1.H.264-NTb.mkv1080pMP4WEB-DLx264~9.5Mbps1080pmp4web-dlx264~9.5mbps.pad-2Peckle'
      ),
      'Reacher.S01E01.1080p.AMZN.WEB-DL.DDP5.1.H.264-NTb.mkv'
    );
  });

  it('strips pad-only residue without a bitrate marker', () => {
    assert.equal(
      stripProviderResidue(
        'Movie.2023.1080p.BluRay.x264.mkv1080pMKVBluRayx264.pad-VAPlayer'
      ),
      'Movie.2023.1080p.BluRay.x264.mkv'
    );
  });

  it('keeps a legit filename untouched', () => {
    const name = 'Reacher.S01E01.1080p.WEB.h264-KOGi.mkv';
    assert.equal(stripProviderResidue(name), name);
  });

  it('keeps a filename whose post-extension junk has no provider marker', () => {
    const name = 'Reacher.S01E01.mkvReacher fake no marker';
    assert.equal(stripProviderResidue(name), name);
  });

  it('keeps a name with numbers glued to the extension but no marker', () => {
    const name = 'A.Movie.2023.mkvandmp4weird';
    assert.equal(stripProviderResidue(name), name);
  });
});
