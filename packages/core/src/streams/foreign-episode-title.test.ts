import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractForeignNumberedEpisodeEnglishTitle } from './foreign-episode-title.js';

describe('foreign numbered episode English title evidence', () => {
  const accepted: Array<[string, string]> = [
    ['1.Пробуждение (The Awakening).mkv', 'The Awakening'],
    ['1.Состояние Аватара (The Avatar State).mkv', 'The Avatar State'],
    ['1.Состояние Аватара (The Avatar State).1080p.mkv', 'The Avatar State'],
    ['1.Состояние Аватара (The Avatar State) [1080p].mkv', 'The Avatar State'],
    [
      '1.Состояние Аватара (The Avatar State) 1080p WEB-DL.mkv',
      'The Avatar State',
    ],
    [
      '1.Состояние Аватара (The Avatar State).2160p.x265.mkv',
      'The Avatar State',
    ],
    ['1.Состояние Аватара (The Avatar State) BluRay.mkv', 'The Avatar State'],
    ['1.アバターの状態 (The Avatar State).1080p.mp4', 'The Avatar State'],
    ['1.Uyanış (The Avatar State).mkv', 'The Avatar State'],
    ['1.Café (The Avatar State).mkv', 'The Avatar State'],
    ['1.日本語 (The Avatar State).mkv', 'The Avatar State'],
    [
      'nested/'.repeat(40) + '1.Название (The Avatar State).mkv',
      'The Avatar State',
    ],
    ['21.Состояние Аватара (The Avatar State).mkv', 'The Avatar State'],
    ['S02/21.Состояние Аватара (The Avatar State).mkv', 'The Avatar State'],
    ['S02\\21.Состояние Аватара (The Avatar State).mkv', 'The Avatar State'],
    [
      '2.Мальчик в айсберге (The Boy in the Iceberg) [720p].mkv',
      'The Boy in the Iceberg',
    ],
  ];

  for (const [filename, title] of accepted) {
    it('extracts ' + filename, () => {
      assert.equal(extractForeignNumberedEpisodeEnglishTitle(filename), title);
    });
  }

  const ignored = [
    'Avatar.The.Last.Airbender.2005.S01E01.The.Boy.in.the.Iceberg.mkv',
    '1.Pilot (The Avatar State).mkv',
    '1.Pilot™ (The Avatar State).mkv',
    '1.Pilot⚡ (The Avatar State).mkv',
    '1.Pilot¹ (The Avatar State).mkv',
    '1.Pilot\u200b (The Avatar State).mkv',
    '1.Серия (1080p WEB-DL).mkv',
    '1.Серия (The Avatar State) GroupRipper.mkv',
    '1.Серия (The Avatar State) GroupRipper.1080p.mkv',
    '1.Серия (The Avatar State).srt',
    '1.Серия (The Avatar State) [Sample].mkv',
    '1.Серия (HDR).mkv',
    '1.Серия (The Avatar State) [unknown-tag].mkv',
    '1.Серия (The Avatar State) 1080p.mp3',
    '1.Серия (The Avatar State) 1080p.mkv.exe',
    '12345.Серия (The Avatar State).mkv',
    'x'.repeat(251) + '.mkv',
  ];

  for (const filename of ignored) {
    it('does not infer from ' + filename.slice(0, 70), () => {
      assert.equal(
        extractForeignNumberedEpisodeEnglishTitle(filename),
        undefined
      );
    });
  }

  it('returns undefined without a filename', () => {
    assert.equal(
      extractForeignNumberedEpisodeEnglishTitle(undefined),
      undefined
    );
  });
});
