import { describe, it, expect } from 'vitest';
import {
  infuseTargetLanguages,
  selectInfuseSubtitles,
  infuseSubProxyUrl,
  infuseSubtitleIsoCode,
  buildInfusePlayUrl,
} from './infuse.js';
import type { Subtitle } from '../db/schemas.js';

const sub = (id: string, url: string, lang: string): Subtitle => ({
  id,
  url,
  lang,
});

describe('infuseTargetLanguages', () => {
  it('defaults to English when none are set', () => {
    expect(infuseTargetLanguages(undefined)).toEqual(['English']);
    expect(infuseTargetLanguages([])).toEqual(['English']);
  });

  it('normalises codes/names and preserves priority order', () => {
    expect(infuseTargetLanguages(['ar'])).toEqual(['Arabic']);
    expect(infuseTargetLanguages(['Arabic', 'en'])).toEqual([
      'Arabic',
      'English',
    ]);
  });

  it('drops unrecognised values, falling back to English if all drop', () => {
    expect(infuseTargetLanguages(['not-a-language'])).toEqual(['English']);
  });
});

describe('selectInfuseSubtitles', () => {
  const subs = [
    sub('1', 'https://x/en1.srt', 'English'),
    sub('2', 'https://x/ar1.srt', 'Arabic'),
    sub('3', 'https://x/ar2.srt', 'Arabic'),
    sub('4', 'https://x/en1.srt', 'English'), // dup URL of #1
  ];

  it('picks by target-language priority, deduped by URL, capped by limit', () => {
    const picked = selectInfuseSubtitles(subs, ['Arabic', 'English'], 3);
    expect(picked.map((s) => s.url)).toEqual([
      'https://x/ar1.srt',
      'https://x/ar2.srt',
      'https://x/en1.srt',
    ]);
  });

  it('respects the limit', () => {
    expect(selectInfuseSubtitles(subs, ['Arabic'], 1).map((s) => s.url)).toEqual(
      ['https://x/ar1.srt']
    );
  });

  it('returns empty when nothing matches', () => {
    expect(selectInfuseSubtitles(subs, ['French'], 3)).toEqual([]);
  });
});

describe('infuseSubtitleIsoCode', () => {
  it('maps a subtitle language to a lowercase ISO 639-1 code', () => {
    expect(infuseSubtitleIsoCode(sub('1', 'u', 'English'))).toBe('en');
    expect(infuseSubtitleIsoCode(sub('1', 'u', 'Arabic'))).toBe('ar');
  });
  it('falls back to und for unknown/empty', () => {
    expect(infuseSubtitleIsoCode(undefined)).toBe('und');
    expect(infuseSubtitleIsoCode(sub('1', 'u', 'gibberish'))).toBe('und');
  });
});

describe('infuseSubProxyUrl', () => {
  it('ends in Subtitle-<iso>.srt and encodes candidates in the path', () => {
    const url = infuseSubProxyUrl(
      'https://addon.example.com/',
      ['https://p/a.srt', 'https://p/b.srt'],
      'ar',
      'Movie.2024.mkv'
    );
    expect(url).toMatch(
      /^https:\/\/addon\.example\.com\/infuse-sub\/[A-Za-z0-9_-]+\/Subtitle-ar\.srt\?t=/
    );
    // trailing slash on baseUrl is normalised (no double slash)
    expect(url).not.toContain('.com//infuse-sub');
    const payload = url.match(/\/infuse-sub\/([A-Za-z0-9_-]+)\//)![1];
    const decoded = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf-8')
    );
    expect(decoded).toEqual(['https://p/a.srt', 'https://p/b.srt']);
  });

  it('omits the ?t= query when no filename is given', () => {
    const url = infuseSubProxyUrl('https://a.co', ['https://p/a.srt'], 'en');
    expect(url.endsWith('Subtitle-en.srt')).toBe(true);
  });
});

describe('buildInfusePlayUrl', () => {
  const base = 'https://addon.example.com';

  it('builds an infuse:// play URL with media, proxied sub, and filename', () => {
    const link = buildInfusePlayUrl(
      base,
      'https://debrid/video.mkv',
      [sub('1', 'https://p/ar.srt', 'Arabic')],
      'Movie.2024.mkv'
    );
    expect(link.startsWith('infuse://x-callback-url/play?url=')).toBe(true);
    expect(link).toContain(encodeURIComponent('https://debrid/video.mkv'));
    expect(link).toContain('&sub=');
    expect(link).toContain('&filename=Movie.2024.mkv');
    // the sub points at our proxy, labelled Arabic
    const subParam = new URL(
      decodeURIComponent(link.split('&sub=')[1].split('&')[0])
    );
    expect(subParam.pathname.endsWith('Subtitle-ar.srt')).toBe(true);
  });

  it('omits sub= when there are no subtitles', () => {
    const link = buildInfusePlayUrl(base, 'https://debrid/v.mkv', []);
    expect(link).not.toContain('&sub=');
    expect(link.startsWith('infuse://x-callback-url/play?url=')).toBe(true);
  });
});
