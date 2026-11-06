import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import '../index.js';
import FileParser from './file.js';

describe('FileParser quality detection (HDDVD REMUX vs DVD REMUX)', () => {
  it('detects HDDVD REMUX as BluRay REMUX instead of DVD REMUX', () => {
    const parsed = FileParser.parse(
      'Accepted.2006.1080p.HDDVD.REMUX.VC-1.DDP5.1-FraMeSToR'
    );
    assert.equal(parsed.quality, 'BluRay REMUX');
    assert.equal(parsed.resolution, '1080p');
  });

  it('detects HD-DVD REMUX and HD.DVD REMUX variants as BluRay REMUX', () => {
    assert.equal(
      FileParser.parse('Movie.2007.1080p.HD-DVD.REMUX.VC-1-GROUP').quality,
      'BluRay REMUX'
    );
    assert.equal(
      FileParser.parse('Movie.2007.1080p.HD.DVD.REMUX.VC-1-GROUP').quality,
      'BluRay REMUX'
    );
    assert.equal(
      FileParser.parse('Movie.2007.1080p.REMUX.HDDVD.VC-1-GROUP').quality,
      'BluRay REMUX'
    );
  });

  it('continues to detect standard DVD REMUX and DVDRip accurately', () => {
    assert.equal(
      FileParser.parse(
        'Aeon.Flux.S02E01.Gravity.NTSC.DVD.DD5.1.MPEG-2.REMUX-GF'
      ).quality,
      'DVD REMUX'
    );
    assert.equal(
      FileParser.parse(
        'Pokemon.Mewtwo.Returns.2001.576i.PAL.DVD.REMUX.MPEG-2.DD5.1-GROUP'
      ).quality,
      'DVD REMUX'
    );
    assert.equal(
      FileParser.parse('Movie.2003.REMUX.PAL.DVD.DD2.0-GROUP').quality,
      'DVD REMUX'
    );
    assert.equal(
      FileParser.parse('Movie.2007.1080p.FHD.DVD.REMUX').quality,
      'DVD REMUX'
    );
    assert.equal(
      FileParser.parse('Movie.2007.DVD5.REMUX-GROUP').quality,
      'DVD REMUX'
    );
    assert.equal(
      FileParser.parse('Movie.2007.REMUX.DVD9-GROUP').quality,
      'DVD REMUX'
    );
    assert.equal(
      FileParser.parse('Movie.2005.DVDRip.XviD-GROUP').quality,
      'DVDRip'
    );
  });
});
