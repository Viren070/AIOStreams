import type { ParsedStream, UserData } from '../db/schemas.js';
import * as constants from '../utils/constants.js';
import { formatHours, makeSmall } from './utils.js';
import { languageToCode, languageToEmoji } from '../utils/languages.js';
import { compileTemplate as engineCompileTemplate } from './engine/compile.js';
import { NEW_LINE_SENTINEL, REMOVE_LINE_SENTINEL } from './engine/sentinels.js';
import { comparatorFunctions } from './engine/comparators.js';

/**
 *
 * The custom formatter code in this file was adapted from https://github.com/diced/zipline/blob/trunk/src/lib/parser/index.ts
 *
 * The original code is licensed under the MIT License.
 *
 * MIT License
 *
 * Copyright (c) 2023 dicedtomato
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

export interface FormatterConfig {
  name: string;
  description: string;
}

export interface ParseValue {
  config?: {
    addonName: string | null;
  };
  stream?: {
    filename: string | null;
    folderName: string | null;
    size: number | null;
    bitrate: number | null;
    folderSize: number | null;
    library: boolean;
    quality: string | null;
    resolution: string | null;
    subbed: boolean;
    dubbed: boolean;
    mediaInfoQuality: string | null;
    languages: string[] | null;
    uLanguages: string[] | null;
    subtitles: string[] | null;
    uSubtitles: string[] | null;
    languageEmojis: string[] | null;
    uLanguageEmojis: string[] | null;
    subtitleEmojis: string[] | null;
    uSubtitleEmojis: string[] | null;
    languageCodes: string[] | null;
    uLanguageCodes: string[] | null;
    subtitleCodes: string[] | null;
    uSubtitleCodes: string[] | null;
    smallLanguageCodes: string[] | null;
    uSmallLanguageCodes: string[] | null;
    smallSubtitleCodes: string[] | null;
    uSmallSubtitleCodes: string[] | null;
    wedontknowwhatakilometeris: string[] | null;
    uWedontknowwhatakilometeris: string[] | null;
    visualTags: string[] | null;
    audioTags: string[] | null;
    releaseGroup: string | null;
    regexMatched: string | null;
    rankedRegexMatched: string[];
    regexScore: number | null;
    nRegexScore: number | null; // normalised (0-100) regex score
    encode: string | null;
    audioChannels: string[] | null;
    edition: string | null;
    editions: string[] | null;
    /** @deprecated moved into `editions`; kept null so old templates don't error */
    remastered: null;
    regraded: boolean;
    repack: boolean;
    proper: boolean;
    uncensored: boolean;
    unrated: boolean;
    upscaled: boolean;
    hasChapters: boolean;
    network: string | null;
    container: string | null;
    extension: string | null;
    indexer: string | null;
    year: string | null;
    title: string | null;
    country: string | null;
    episodeTitle: string | null;
    date: string | null;
    folderSeasons: number[] | null;
    formattedFolderSeasons: string | null;
    seasons: number[] | null;
    season: number | null;
    formattedSeasons: string | null;
    episodes: number[] | null;
    episode: number | null;
    formattedEpisodes: string | null;
    folderEpisodes: number[] | null;
    formattedFolderEpisodes: string | null;
    seasonEpisode: string[] | null;
    seasonPack: boolean;
    seeders: number | null;
    private: boolean;
    freeleech: boolean | null;
    age: string | null;
    ageHours: number | null;
    duration: number | null;
    infoHash: string | null;
    type: string | null;
    message: string | null;
    proxied: boolean;
    seadex: boolean;
    seadexBest: boolean;
    seScore: number | null;
    nSeScore: number | null; // normalised (0-100) based on max and min scores (neg scores become 0)
    seMatched: string | null;
    rseMatched: string[];
    preloading: boolean;
    idMatched: boolean;
  };
  metadata?: {
    queryType: string | null;
    type: string | null;
    isAnime: boolean;
    title: string | null;
    titles: string[] | null;
    year: number | null;
    yearEnd: number | null;
    runtime: number | null;
    episodeRuntime: number | null;
    genres: string[] | null;
    originalLanguage: string | null;
    country: string | null;
    season: number | null;
    episode: number | null;
    absoluteEpisode: number | null;
    relativeAbsoluteEpisode: number | null;
    episodeTitle: string | null;
    episodeTitles: string[] | null;
    latestSeason: number | null;
    daysSinceRelease: number | null;
    daysSinceFirstAired: number | null;
    daysSinceLastAired: number | null;
    hasNextEpisode: boolean;
    daysUntilNextEpisode: number | null;
    anilistId: number | null;
    malId: number | null;
    hasSeaDex: boolean;
  };
  service?: {
    id: string | null;
    shortName: string | null;
    name: string | null;
    cached: boolean | null;
  };
  addon?: {
    name: string | null;
    presetId: string | null;
    manifestUrl: string | null;
  };
  debug?: {
    json: string | null;
    jsonf: string | null;
  };
}

/**
 * Pre-compiled function that takes ParseValue and returns formatted string
 */
type CompiledParseFunction = (parseValue: ParseValue) => string;

// Kept free of node-only imports so the SPA can render previews with it.
export interface FormatterContext {
  userData: UserData;
  addonName?: string;
  onWarning?: (message: string) => void;
  // From ExpressionContext
  type?: string;
  isAnime?: boolean;
  queryType?: string;
  season?: number;
  episode?: number;
  title?: string;
  titles?: string[];
  year?: number;
  yearEnd?: number;
  genres?: string[];
  runtime?: number;
  episodeRuntime?: number;
  absoluteEpisode?: number;
  relativeAbsoluteEpisode?: number;
  originalLanguage?: string;
  country?: string;
  episodeTitles?: string[];
  daysSinceRelease?: number;
  hasNextEpisode?: boolean;
  daysUntilNextEpisode?: number;
  daysSinceFirstAired?: number;
  daysSinceLastAired?: number;
  latestSeason?: number;
  anilistId?: number;
  malId?: number;
  hasSeaDex?: boolean;
  maxSeScore?: number;
  maxRegexScore?: number;
}

export abstract class BaseFormatter {
  protected config: FormatterConfig;
  protected userData: UserData;
  protected formatterContext: FormatterContext;

  private precompiledNameFunction: CompiledParseFunction | null = null;
  private precompiledDescriptionFunction: CompiledParseFunction | null = null;

  private _compilationPromise: Promise<void>;

  constructor(config: FormatterConfig, ctx: FormatterContext) {
    this.config = config;
    this.userData = ctx.userData;
    this.formatterContext = ctx;

    // Start template compilation asynchronously in the background
    this._compilationPromise = this.compileTemplatesAsync();
  }

  private async compileTemplatesAsync(): Promise<void> {
    this.precompiledNameFunction = await this.getCompiledTemplate(
      this.config.name
    );
    this.precompiledDescriptionFunction = await this.getCompiledTemplate(
      this.config.description
    );
  }

  private static compiledTemplates = new Map<string, CompiledParseFunction>();
  private static readonly MAX_CACHED_TEMPLATES = 200;

  private async getCompiledTemplate(
    template: string
  ): Promise<CompiledParseFunction> {
    const cached = BaseFormatter.compiledTemplates.get(template);
    if (cached) return cached;

    const compiled = await this.compileTemplate(template);

    // templates are user-supplied, so the map is bounded
    if (
      BaseFormatter.compiledTemplates.size >= BaseFormatter.MAX_CACHED_TEMPLATES
    ) {
      BaseFormatter.compiledTemplates.clear();
    }
    BaseFormatter.compiledTemplates.set(template, compiled);
    return compiled;
  }

  public async format(
    stream: ParsedStream
  ): Promise<{ name: string; description: string }> {
    // Wait for template compilation to complete if it hasn't already
    await this._compilationPromise;

    if (!this.precompiledNameFunction || !this.precompiledDescriptionFunction) {
      throw new Error('Template compilation failed - formatter not ready');
    }

    const parseValue = this.convertStreamToParseValue(stream);
    return {
      name: this.precompiledNameFunction(parseValue),
      description: this.precompiledDescriptionFunction(parseValue),
    };
  }

  protected convertStreamToParseValue(stream: ParsedStream): ParseValue {
    // Get original language from formatter context instead of from the stream's languages array hack

    const getPaddedNumber = (number: number, length: number) =>
      number.toString().padStart(length, '0');
    const formattedSeasonString = stream.parsedFile?.seasons?.length
      ? stream.parsedFile.seasons.length === 1
        ? `S${getPaddedNumber(stream.parsedFile.seasons[0], 2)}`
        : `S${getPaddedNumber(stream.parsedFile.seasons[0], 2)}-${getPaddedNumber(stream.parsedFile.seasons[stream.parsedFile.seasons.length - 1], 2)}`
      : undefined;
    const formattedEpisodeString = stream.parsedFile?.episodes?.length
      ? stream.parsedFile.episodes.length === 1
        ? `E${getPaddedNumber(stream.parsedFile.episodes[0], 2)}`
        : `E${getPaddedNumber(stream.parsedFile.episodes[0], 2)}-${getPaddedNumber(stream.parsedFile.episodes[stream.parsedFile.episodes.length - 1], 2)}`
      : undefined;
    const seasonEpisode = [
      formattedSeasonString,
      formattedEpisodeString,
    ].filter((v) => v !== undefined);

    const formattedFolderSeasonString = stream.parsedFile?.folderSeasons?.length
      ? stream.parsedFile.folderSeasons.length === 1
        ? `S${getPaddedNumber(stream.parsedFile.folderSeasons[0], 2)}`
        : `S${getPaddedNumber(stream.parsedFile.folderSeasons[0], 2)}-${getPaddedNumber(stream.parsedFile.folderSeasons[stream.parsedFile.folderSeasons.length - 1], 2)}`
      : undefined;

    const formattedFolderEpisodesString = stream.parsedFile?.folderEpisodes
      ?.length
      ? stream.parsedFile.folderEpisodes.length === 1
        ? `E${getPaddedNumber(stream.parsedFile.folderEpisodes[0], 2)}`
        : `E${getPaddedNumber(stream.parsedFile.folderEpisodes[0], 2)}-${getPaddedNumber(stream.parsedFile.folderEpisodes[stream.parsedFile.folderEpisodes.length - 1], 2)}`
      : undefined;

    const getFieldValues = (field: string): string[] => {
      // capitalise first letter
      const key = field.charAt(0).toUpperCase() + field.slice(1);
      return [
        ...((this.userData[`preferred${key}` as keyof UserData] ||
          []) as string[]),
        ...((this.userData[`required${key}` as keyof UserData] ||
          []) as string[]),
        ...((this.userData[`included${key}` as keyof UserData] ||
          []) as string[]),
      ];
    };

    const sortByUserPreference = <T extends string>(
      items: T[] | undefined,
      userPrefs: string[]
    ): T[] | null => {
      if (!items) return null;
      if (!userPrefs.length) return items;
      return [...items].sort((a, b) => {
        const aIndex = userPrefs.indexOf(a);
        const bIndex = userPrefs.indexOf(b);
        const aInPrefs = aIndex !== -1;
        const bInPrefs = bIndex !== -1;
        if (aInPrefs && bInPrefs) {
          return aIndex - bIndex;
        }
        return aInPrefs ? -1 : bInPrefs ? 1 : 0;
      });
    };

    const userSpecifiedLanguages = [
      ...new Set(
        getFieldValues('languages').map((lang) =>
          lang === 'Original' && this.formatterContext.originalLanguage
            ? this.formatterContext.originalLanguage
            : lang
        )
      ),
    ];
    const userSpecifiedSubtitles = [
      ...new Set(
        getFieldValues('subtitles').map((lang) =>
          lang === 'Original' && this.formatterContext.originalLanguage
            ? this.formatterContext.originalLanguage
            : lang
        )
      ),
    ];

    const buildLanguageVariants = (
      values: string[] | undefined,
      userSpecifiedValues: string[]
    ) => {
      const sortedValues = sortByUserPreference(values, userSpecifiedValues);

      const userValues = sortedValues
        ? sortedValues.filter((value) =>
            userSpecifiedValues.includes(value as any)
          )
        : null;

      const applyModifiers = (
        list: string[] | null,
        ...modifiers: Array<(value: string) => string | undefined>
      ): string[] | null => {
        if (!list) return null;

        const modified = list.map((value) =>
          modifiers.reduce<string | undefined>(
            (acc, modifier) =>
              acc !== undefined ? (modifier(acc) ?? acc) : undefined,
            value
          )
        );

        return [...new Set(modified.filter(Boolean) as string[])];
      };
      const emojis = applyModifiers(sortedValues, languageToEmoji);
      const userEmojis = applyModifiers(userValues, languageToEmoji);
      const codes = applyModifiers(
        sortedValues,
        (value) => languageToCode(value) || value.toUpperCase()
      );
      const userCodes = applyModifiers(
        userValues,
        (value) => languageToCode(value) || value.toUpperCase()
      );
      const smallCodes = applyModifiers(
        sortedValues,
        languageToCode,
        makeSmall
      );
      const userSmallCodes = applyModifiers(
        userValues,
        languageToCode,
        makeSmall
      );
      const usEmojis = applyModifiers(sortedValues, languageToEmoji, (emoji) =>
        emoji.replace('🇬🇧', '🇺🇸🦅')
      );
      const userUsEmojis = applyModifiers(
        userValues,
        languageToEmoji,
        (emoji) => emoji.replace('🇬🇧', '🇺🇸🦅')
      );

      return {
        sortedValues,
        userValues,
        emojis,
        userEmojis,
        codes,
        userCodes,
        smallCodes,
        userSmallCodes,
        usEmojis,
        userUsEmojis,
      };
    };

    // built on first read: most templates reference none of the twenty
    // language/subtitle variants
    const memo = <T>(build: () => T): (() => T) => {
      let value: T | undefined;
      let built = false;
      return () => {
        if (!built) {
          value = build();
          built = true;
        }
        return value as T;
      };
    };

    const languageVariants = memo(() =>
      buildLanguageVariants(
        stream.parsedFile?.languages,
        userSpecifiedLanguages
      )
    );
    const subtitleVariants = memo(() =>
      buildLanguageVariants(
        stream.parsedFile?.subtitles,
        userSpecifiedSubtitles?.length
          ? userSpecifiedSubtitles
          : userSpecifiedLanguages
      )
    );
    const sortedAudioChannels = sortByUserPreference(
      stream.parsedFile?.audioChannels,
      getFieldValues('audioChannels')
    );
    const sortedAudioTags = sortByUserPreference(
      stream.parsedFile?.audioTags,
      getFieldValues('audioTags')
    );
    const sortedVisualTags = sortByUserPreference(
      stream.parsedFile?.visualTags,
      getFieldValues('visualTags')
    );

    const formattedAge = stream.age ? formatHours(stream.age) : null;
    const parseValue: ParseValue = {
      config: {
        addonName:
          this.userData.addonName ||
          this.formatterContext.addonName ||
          'AIOStreams',
      },
      stream: {
        filename: stream.filename || null,
        folderName: stream.folderName || null,
        size: stream.size || null,
        folderSize: stream.folderSize || null,
        library: stream.library ?? false,
        quality: stream.parsedFile?.quality || null,
        resolution: stream.parsedFile?.resolution || null,
        subbed:
          stream.parsedFile?.subbed || !!stream.parsedFile?.subtitles?.length,
        dubbed: stream.parsedFile?.dubbed || false,
        mediaInfoQuality: stream.parsedFile?.mediaInfoQuality ?? null,
        get languages() {
          return languageVariants().sortedValues;
        },
        get uLanguages() {
          return languageVariants().userValues;
        },
        get subtitles() {
          return subtitleVariants().sortedValues;
        },
        get uSubtitles() {
          return subtitleVariants().userValues;
        },
        get languageEmojis() {
          return languageVariants().emojis;
        },
        get uLanguageEmojis() {
          return languageVariants().userEmojis;
        },
        get subtitleEmojis() {
          return subtitleVariants().emojis;
        },
        get uSubtitleEmojis() {
          return subtitleVariants().userEmojis;
        },
        get languageCodes() {
          return languageVariants().codes;
        },
        get uLanguageCodes() {
          return languageVariants().userCodes;
        },
        get subtitleCodes() {
          return subtitleVariants().codes;
        },
        get uSubtitleCodes() {
          return subtitleVariants().userCodes;
        },
        get smallLanguageCodes() {
          return languageVariants().smallCodes;
        },
        get uSmallLanguageCodes() {
          return languageVariants().userSmallCodes;
        },
        get smallSubtitleCodes() {
          return subtitleVariants().smallCodes;
        },
        get uSmallSubtitleCodes() {
          return subtitleVariants().userSmallCodes;
        },
        get wedontknowwhatakilometeris() {
          return languageVariants().usEmojis;
        },
        get uWedontknowwhatakilometeris() {
          return languageVariants().userUsEmojis;
        },
        visualTags: sortedVisualTags,
        audioTags: sortedAudioTags,
        releaseGroup: stream.parsedFile?.releaseGroup || null,
        regexMatched:
          stream.regexMatched?.name || stream.rankedRegexesMatched?.[0] || null,
        rankedRegexMatched:
          stream.rankedRegexesMatched?.filter(
            (name): name is string => typeof name === 'string'
          ) || [],
        regexScore: stream.regexScore ?? null,
        nRegexScore:
          stream.regexScore != undefined &&
          this.formatterContext.maxRegexScore != undefined &&
          this.formatterContext.maxRegexScore > 0
            ? Math.max(
                0,
                Math.min(
                  100,
                  Math.round(
                    (stream.regexScore / this.formatterContext.maxRegexScore) *
                      100
                  )
                )
              )
            : null,
        encode: stream.parsedFile?.encode || null,
        audioChannels: sortedAudioChannels || null,
        indexer: stream.indexer || null,
        seeders: stream.torrent?.seeders ?? null,
        private: stream.torrent?.private ?? false,
        freeleech: stream.torrent?.freeleech ?? null,
        year: stream.parsedFile?.year || null,
        type: stream.type || null,
        title: stream.parsedFile?.title || null,
        country: stream.parsedFile?.country || null,
        episodeTitle: stream.parsedFile?.episodeTitle || null,
        date: stream.parsedFile?.date || null,
        season: stream.parsedFile?.seasons?.[0] || null,
        formattedSeasons: formattedSeasonString || null,
        seasons: stream.parsedFile?.seasons || null,
        folderSeasons: stream.parsedFile?.folderSeasons || null,
        formattedFolderSeasons: formattedFolderSeasonString || null,
        episode: stream.parsedFile?.episodes?.[0] || null,
        formattedEpisodes: formattedEpisodeString || null,
        episodes: stream.parsedFile?.episodes || null,
        formattedFolderEpisodes: formattedFolderEpisodesString || null,
        folderEpisodes: stream.parsedFile?.folderEpisodes || null,
        seasonEpisode: seasonEpisode || null,
        seasonPack: stream.parsedFile?.seasonPack ?? false,
        duration: stream.duration || null,
        bitrate: stream.bitrate ?? null,
        infoHash: stream.torrent?.infoHash || null,
        age: formattedAge,
        ageHours: stream.age || null,
        message: stream.message || null,
        proxied: stream.proxied ?? false,
        edition: stream.parsedFile?.editions?.[0] || null,
        editions: stream.parsedFile?.editions || null,
        regraded: stream.parsedFile?.regraded ?? false,
        remastered: null,
        repack: stream.parsedFile?.repack ?? false,
        proper: stream.parsedFile?.proper ?? false,
        uncensored: stream.parsedFile?.uncensored ?? false,
        unrated: stream.parsedFile?.unrated ?? false,
        upscaled: stream.parsedFile?.upscaled ?? false,
        hasChapters: stream.parsedFile?.hasChapters ?? false,
        network: stream.parsedFile?.network || null,
        container: stream.parsedFile?.container || null,
        extension: stream.parsedFile?.extension || null,
        seadex: stream.seadex?.isSeadex ?? false,
        seadexBest: stream.seadex?.isBest ?? false,
        nSeScore:
          stream.streamExpressionScore != undefined &&
          this.formatterContext.maxSeScore != undefined &&
          this.formatterContext.maxSeScore > 0
            ? Math.max(
                0,
                Math.min(
                  100,
                  Math.round(
                    (stream.streamExpressionScore /
                      this.formatterContext.maxSeScore) *
                      100
                  )
                )
              )
            : null,
        seScore: stream.streamExpressionScore ?? null,
        seMatched: stream.streamExpressionMatched?.name || null,
        rseMatched:
          stream.rankedStreamExpressionsMatched?.filter(
            (name): name is string => typeof name === 'string'
          ) || [],
        preloading: stream.preloading ?? false,
        idMatched: stream.idMatched ?? false,
      },
      metadata: {
        queryType: this.formatterContext.queryType || null,
        type: this.formatterContext.type || null,
        isAnime: this.formatterContext.isAnime ?? false,
        title: this.formatterContext.title || null,
        titles: this.formatterContext.titles || null,
        year: this.formatterContext.year || null,
        yearEnd: this.formatterContext.yearEnd || null,
        runtime: this.formatterContext.runtime || null,
        episodeRuntime: this.formatterContext.episodeRuntime || null,
        genres: this.formatterContext.genres || null,
        originalLanguage: this.formatterContext.originalLanguage || null,
        country: this.formatterContext.country || null,
        // ?? rather than ||: season 0 (specials) and a 0-day age are real values
        season: this.formatterContext.season ?? null,
        episode: this.formatterContext.episode ?? null,
        absoluteEpisode: this.formatterContext.absoluteEpisode ?? null,
        relativeAbsoluteEpisode:
          this.formatterContext.relativeAbsoluteEpisode ?? null,
        episodeTitle: this.formatterContext.episodeTitles?.[0] || null,
        episodeTitles: this.formatterContext.episodeTitles || null,
        latestSeason: this.formatterContext.latestSeason ?? null,
        daysSinceRelease: this.formatterContext.daysSinceRelease ?? null,
        daysSinceFirstAired: this.formatterContext.daysSinceFirstAired ?? null,
        daysSinceLastAired: this.formatterContext.daysSinceLastAired ?? null,
        hasNextEpisode: this.formatterContext.hasNextEpisode ?? false,
        daysUntilNextEpisode:
          this.formatterContext.daysUntilNextEpisode ?? null,
        anilistId: this.formatterContext.anilistId ?? null,
        malId: this.formatterContext.malId ?? null,
        hasSeaDex: this.formatterContext.hasSeaDex ?? false,
      },
      addon: {
        name: stream.addon?.name || null,
        presetId: stream.addon?.preset?.type || null,
        manifestUrl: stream.addon?.manifestUrl || null,
      },
      service: {
        id: stream.service?.id || null,
        shortName: stream.service?.id
          ? Object.values(constants.SERVICE_DETAILS).find(
              (service) => service.id === stream.service?.id
            )?.shortName || null
          : null,
        name: stream.service?.id
          ? Object.values(constants.SERVICE_DETAILS).find(
              (service) => service.id === stream.service?.id
            )?.name || null
          : null,
        cached:
          stream.service?.cached !== undefined ? stream.service?.cached : null,
      },
    };
    // spreading invokes the getters above, so every field is still present,
    // in declaration order
    parseValue.debug = {
      get json() {
        return JSON.stringify({ ...parseValue, debug: undefined });
      },
      get jsonf() {
        return JSON.stringify(
          { ...parseValue, debug: undefined },
          (_, value) => value,
          2
        );
      },
    } as ParseValue['debug'];
    return parseValue;
  }

  protected async compileTemplate(str: string): Promise<CompiledParseFunction> {
    const compiled = this.compileWithEngine(str);
    return (parseValue: ParseValue) => {
      // layout comes from sentinels the template emitted, never from rendered text
      return compiled(parseValue)
        .split('\n')
        .filter(
          (line) => line.trim() !== '' && !line.includes(REMOVE_LINE_SENTINEL)
        )
        .join('\n')
        .replaceAll(NEW_LINE_SENTINEL, '\n');
    };
  }

  /**
   */
  private compileWithEngine(str: string): CompiledParseFunction {
    return engineCompileTemplate<ParseValue>(str, {
      resolveVariable: (source, parseValue) => {
        // only used for replace({section.property}, 'x')
        const [section, property] = source.split('.');
        const value = (parseValue as any)?.[section]?.[property];
        return value == null ? undefined : String(value);
      },
      comparators: comparatorFunctions,
      onDepthExceeded: (max) =>
        this.formatterContext.onWarning?.(
          `Template nesting depth exceeded (max ${max}). Returning literal text.`
        ),
    });
  }
}
