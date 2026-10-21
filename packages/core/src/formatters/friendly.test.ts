import { describe, expect, it } from 'vitest';
import { compileTemplate, type CompileHooks } from './engine/index.js';
import type { ParsedStream } from '../db/schemas.js';
import { friendlyLabel, streamWarnings } from './friendly.js';

const hooks: CompileHooks<Record<string, any>> = {
  resolveVariable: () => undefined,
  resolveValues: () => undefined,
  comparators: {},
};

const render = (template: string, stream: Record<string, unknown>) =>
  compileTemplate(template, hooks)({ stream });

describe('friendlyLabel', () => {
  it('translates known tags, ignoring case', () => {
    expect(friendlyLabel('WEB-DL')).toBe('Streaming (original)');
    expect(friendlyLabel('dv')).toBe('Dolby Vision');
    expect(friendlyLabel('5.1')).toBe('5.1 Surround');
  });

  it('leaves unknown tags alone', () => {
    expect(friendlyLabel('Something New')).toBe('Something New');
  });
});

describe('::friendly', () => {
  it('works on strings and lists', () => {
    expect(
      render('{stream.quality::friendly}', { quality: 'BluRay REMUX' })
    ).toBe('Blu-ray (exact copy)');
    expect(
      render("{stream.audioTags::friendly::join(' · ')}", {
        audioTags: ['Atmos', 'TrueHD'],
      })
    ).toBe('Dolby Atmos · Dolby TrueHD (lossless)');
  });
});

const stream = (
  parsedFile: Partial<NonNullable<ParsedStream['parsedFile']>>,
  extra: Partial<ParsedStream> = {}
) =>
  ({
    type: 'debrid',
    parsedFile: {
      visualTags: [],
      audioTags: [],
      audioChannels: [],
      languages: [],
      ...parsedFile,
    },
    ...extra,
  }) as ParsedStream;

describe('streamWarnings', () => {
  it('warns about Dolby Vision without an HDR fallback', () => {
    expect(streamWarnings(stream({ visualTags: ['DV'] }))).toEqual([
      'Dolby Vision only (colours may look wrong without DV)',
    ]);
    expect(streamWarnings(stream({ visualTags: ['DV', 'HDR10'] }))).toEqual([]);
  });

  it('warns about DTS/TrueHD only when there is no other audio', () => {
    expect(streamWarnings(stream({ audioTags: ['Atmos', 'TrueHD'] }))).toEqual([
      'DTS/TrueHD audio only (some TVs and browsers have no sound)',
    ]);
    expect(streamWarnings(stream({ audioTags: ['TrueHD', 'DD+'] }))).toEqual(
      []
    );
  });

  it('collects every applicable warning', () => {
    expect(
      streamWarnings(
        stream(
          {
            quality: 'CAM',
            visualTags: ['3D'],
            upscaled: true,
            extension: 'iso',
          },
          {
            service: { id: 'realdebrid', cached: false },
            torrent: { seeders: 0 },
          } as Partial<ParsedStream>
        )
      )
    ).toEqual([
      'Recorded in a cinema (poor picture and sound)',
      'Upscaled (not true resolution)',
      '3D (needs a 3D display)',
      'Disc image (may not play)',
      'Not cached (has to download before playing)',
      'No seeders (may never start)',
    ]);
  });

  it('is empty for a clean release', () => {
    expect(
      streamWarnings(
        stream({
          quality: 'WEB-DL',
          encode: 'HEVC',
          visualTags: ['HDR10', '10bit'],
          audioTags: ['DD+'],
        })
      )
    ).toEqual([]);
  });
});
