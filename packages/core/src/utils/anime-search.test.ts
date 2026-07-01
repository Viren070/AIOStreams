import { describe, expect, it } from 'vitest';
import type { AnimeEntry } from '../anime-database/index.js';
import {
  buildAmbiguousAnimeQueryWaves,
  buildAnimeTitles,
  calculateLogicalEpisode,
  extractLogicalSeasonFromTitles,
  selectAmbiguousAnimeBaseTitles,
  selectAmbiguousAnimeEntryTitles,
} from './anime-search.js';

describe('anime search metadata helpers', () => {
  it('extracts logical season numbers from common anime sequel titles', () => {
    expect(
      extractLogicalSeasonFromTitles(['Bungo Stray Dogs 4th Season'])
    ).toBe(4);
    expect(extractLogicalSeasonFromTitles(['Frieren Season 2'])).toBe(2);
    expect(extractLogicalSeasonFromTitles(['Example Anime III Season'])).toBe(
      3
    );
    expect(
      extractLogicalSeasonFromTitles([
        'Example Anime XI Season',
        'Example Anime 4th Season',
      ])
    ).toBe(4);
    expect(
      extractLogicalSeasonFromTitles(['Example Anime Final Season Part 2'])
    ).toBeUndefined();
  });

  it('converts external episode numbers to entry-relative logical episodes', () => {
    const animeEntry = {
      type: 'TV',
      tmdb: { seasonNumber: 3, seasonId: 1, fromEpisode: 14 },
      tvdb: { seasonNumber: 3, seasonId: 1 },
    } as unknown as AnimeEntry;

    expect(calculateLogicalEpisode(14, animeEntry)).toBe(1);
    expect(calculateLogicalEpisode(25, animeEntry)).toBe(12);
  });

  it('keeps sequel-specific titles while deriving base-title search candidates', () => {
    const animeEntry = {
      title: 'Bungo Stray Dogs 4th Season',
      synonyms: ['Bungou Stray Dogs 4th Season'],
      type: 'TV',
      tmdb: { seasonNumber: 3, seasonId: 1 },
      tvdb: { seasonNumber: 3, seasonId: 1 },
    } as unknown as AnimeEntry;

    const titles = buildAnimeTitles(animeEntry, 'Bungo Stray Dogs', 4, 2023);

    expect(titles).toContain('Bungo Stray Dogs 4th Season');
    expect(
      selectAmbiguousAnimeBaseTitles({
        primaryTitle: titles[0],
        titles,
        externalTitle: 'Bungo Stray Dogs',
        logicalSeason: 4,
        seasonYear: 2023,
      })
    ).toContain('Bungo Stray Dogs');
    expect(
      selectAmbiguousAnimeBaseTitles({
        primaryTitle: 'Bungo Stray Dogs 4th Season',
        titles: [
          'Bungo Stray Dogs 4th Season',
          'Bungo Stray Dogs Season 4',
          'Bungou Stray Dogs 4th Season',
        ],
        logicalSeason: 4,
      })
    ).toEqual(['Bungo Stray Dogs', 'Bungou Stray Dogs']);
    expect(
      selectAmbiguousAnimeEntryTitles({
        primaryTitle: titles[0],
        titles,
      })
    ).toContain('Bungo Stray Dogs 4th Season');
  });

  it('builds bounded Bungo-style query waves for split-cour anime entries', () => {
    const waves = buildAmbiguousAnimeQueryWaves({
      primaryTitle: 'Bungo Stray Dogs 4th Season',
      titles: ['Bungo Stray Dogs 4th Season', 'Bungou Stray Dogs 4th Season'],
      externalTitle: 'Bungo Stray Dogs',
      externalTitles: ['Bungo Stray Dogs'],
      logicalSeason: 4,
      logicalEpisode: 1,
      seasonYear: 2023,
    });

    expect(waves).toEqual([
      [
        'Bungo Stray Dogs S04E01',
        'Bungo Stray Dogs S04',
        'Bungou Stray Dogs S04E01',
        'Bungou Stray Dogs S04',
      ],
      [
        'Bungo Stray Dogs 4th Season 01',
        'Bungo Stray Dogs 4th Season E01',
        'Bungou Stray Dogs 4th Season 01',
        'Bungou Stray Dogs 4th Season E01',
      ],
    ]);
  });
});
