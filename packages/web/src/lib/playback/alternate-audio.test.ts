import { describe, expect, it, vi } from 'vitest';
import type { SourceInfo } from '../types';
import { alternateAudio } from './alternate-audio';

vi.mock('./stream', () => ({
  needsAppPlayer: (source: SourceInfo) => !!source.RequiredHttpHeaders,
}));

function source(
  id: string,
  resolution: string,
  languages: string[]
): SourceInfo {
  return {
    Id: id,
    aiostreams: { resolution } as SourceInfo['aiostreams'],
    MediaStreams: languages.map((Language) => ({ Type: 'Audio', Language })),
  };
}

describe('alternate audio', () => {
  it('normalizes aliases, keeps regional languages distinct and favors the current resolution', () => {
    const current = source('current', '1080p', ['eng']);
    const options = alternateAudio(
      current,
      [{ lang: 'en' }],
      [
        current,
        source('lower', '720p', ['pt-BR']),
        source('same', '1080p', ['pt-BR', 'pt-PT', 'eng']),
        source('later', '1080p', ['pt-BR']),
        source('german', '2160p', ['deu']),
      ]
    );
    expect(
      options.map(({ language, source }) => [language, source.Id])
    ).toEqual([
      ['pt-BR', 'same'],
      ['pt-PT', 'same'],
      ['ger', 'german'],
    ]);
  });

  it('omits subtitles, unknown audio and versions requiring another player', () => {
    const current = source('current', '1080p', ['eng']);
    const unknown = source('unknown', '1080p', ['und']);
    unknown.MediaStreams?.push({ Type: 'Subtitle', Language: 'spa' });
    const blocked = source('blocked', '1080p', ['jpn']);
    blocked.RequiredHttpHeaders = { Referer: 'https://example.com' };
    expect(alternateAudio(current, [], [current, unknown, blocked])).toEqual(
      []
    );
  });
});
