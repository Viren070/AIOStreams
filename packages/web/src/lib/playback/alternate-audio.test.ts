import { describe, expect, it, vi } from 'vitest';
import type { SourceInfo } from '../types';
import {
  alternateAudio,
  audioChoices,
  playingAudioLanguage,
  sourceDefaultsToAudio,
} from './alternate-audio';

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
    expect(
      alternateAudio(current, [], [current, unknown, blocked], true)
    ).toMatchObject([{ source: { Id: 'blocked' } }]);
  });

  it('accepts the advertised default language for a browser that cannot enumerate audio tracks', () => {
    const bilingual = source('bilingual', '1080p', ['eng', 'fra']);
    bilingual.MediaStreams![0].Index = 0;
    bilingual.MediaStreams![1].Index = 1;
    bilingual.DefaultAudioStreamIndex = 1;
    expect(sourceDefaultsToAudio(bilingual, 'fre')).toBe(true);
    expect(sourceDefaultsToAudio(bilingual, 'eng')).toBe(false);
    expect(
      sourceDefaultsToAudio(source('single', '1080p', ['fra']), 'fre')
    ).toBe(true);
    bilingual.DefaultAudioStreamIndex = undefined;
    expect(sourceDefaultsToAudio(bilingual, 'fre')).toBe(false);
  });

  it('pins the original version on top and drops its language from the rest', () => {
    const original = source('original', '1080p', ['eng']);
    const dubbed = source('dubbed', '1080p', ['fra']);
    const other = source('other', '720p', ['eng', 'deu']);
    const choices = audioChoices(
      dubbed,
      [{ lang: 'fra' }],
      [original, dubbed, other],
      false,
      { sourceId: 'original', language: 'eng' }
    );
    expect(choices.original).toMatchObject({
      language: 'eng',
      source: { Id: 'original' },
    });
    expect(
      choices.options.map(({ language, source }) => [language, source.Id])
    ).toEqual([['ger', 'other']]);
  });

  it('pins nothing while the original plays or once it is gone', () => {
    const original = source('original', '1080p', ['eng']);
    const dubbed = source('dubbed', '1080p', ['fra']);
    const pin = { sourceId: 'original', language: 'eng' };
    expect(
      audioChoices(original, [], [original, dubbed], false, pin).original
    ).toBeUndefined();
    expect(audioChoices(dubbed, [], [dubbed], false, pin)).toEqual({
      options: [],
    });
  });

  it('takes the playing language from the selected track, else the source', () => {
    const bilingual = source('bilingual', '1080p', ['eng', 'fra']);
    const tracks = [
      { id: 'a1', lang: 'en' },
      { id: 'a2', lang: 'fr' },
    ];
    expect(playingAudioLanguage(bilingual, tracks, 'a2')).toBe('fre');
    expect(playingAudioLanguage(bilingual, [], null)).toBe('eng');
    expect(playingAudioLanguage(source('none', '1080p', []), [], null)).toBe(
      undefined
    );
  });
});
