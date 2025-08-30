import { ParsedStream, UserData } from '../db';
// import { constants, Env, createLogger } from '../utils';
import * as constants from '../utils/constants';
import { createLogger } from '../utils/logger';
import {
  formatBytes,
  formatDuration,
  languageToCode,
  languageToEmoji,
  makeSmall,
} from './utils';
import { Env } from '../utils/env';

const logger = createLogger('formatter');

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
    folderSize: number | null;
    library: boolean | null;
    quality: string | null;
    resolution: string | null;
    languages: string[] | null;
    uLanguages: string[] | null;
    languageEmojis: string[] | null;
    uLanguageEmojis: string[] | null;
    languageCodes: string[] | null;
    uLanguageCodes: string[] | null;
    smallLanguageCodes: string[] | null;
    uSmallLanguageCodes: string[] | null;
    wedontknowwhatakilometeris: string[] | null;
    uWedontknowwhatakilometeris: string[] | null;
    visualTags: string[] | null;
    audioTags: string[] | null;
    releaseGroup: string | null;
    regexMatched: string | null;
    encode: string | null;
    audioChannels: string[] | null;
    indexer: string | null;
    year: string | null;
    title: string | null;
    season: number | null;
    seasons: number[] | null;
    episode: number | null;
    seasonEpisode: string[] | null;
    seeders: number | null;
    age: string | null;
    duration: number | null;
    infoHash: string | null;
    type: string | null;
    message: string | null;
    proxied: boolean | null;
  };
  service?: {
    id: string | null;
    shortName: string | null;
    name: string | null;
    cached: boolean | null;
  };
  addon?: {
    name: string;
    presetId: string;
    manifestUrl: string;
  };
  debug?: {
    json: string | null;
    jsonf: string | null;
  };
}

export const hardcodedParseValueKeysForRegexMatching: ParseValue = {
  stream: {
    filename: null,
    folderName: null,
    size: null,
    folderSize: null,
    library: null,
    quality: null,
    resolution: null,
    languages: null,
    uLanguages: null,
    languageEmojis: null,
    uLanguageEmojis: null,
    languageCodes: null,
    uLanguageCodes: null,
    smallLanguageCodes: null,
    uSmallLanguageCodes: null,
    wedontknowwhatakilometeris: null,
    uWedontknowwhatakilometeris: null,
    visualTags: null,
    audioTags: null,
    releaseGroup: null,
    regexMatched: null,
    encode: null,
    audioChannels: null,
    indexer: null,
    year: null,
    title: null,
    season: null,
    seasons: null,
    episode: null,
    seasonEpisode: null,
    seeders: null,
    age: null,
    duration: null,
    infoHash: null,
    type: null,
    message: null,
    proxied: null,
  },
  service: {
    id: null,
    shortName: null,
    name: null,
    cached: null,
  },
  addon: {
    name: "",
    presetId: "",
    manifestUrl: "",
  },
  config: {
    addonName: null,
  },
}

export const stringModifiers = {
  'upper': (value: string) => value.toUpperCase(),
  'lower': (value: string) => value.toLowerCase(),
  'title': (value: string) => value
            .split(' ')
            .map((word) => word.toLowerCase())
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' '),
  'length': (value: string) => value.length.toString(),
  'reverse': (value: string) => value.split('').reverse().join(''),
  'base64': (value: string) => btoa(value),
  'string': (value: string) => value,
}

const arrayModifierGetOrDefault = (value: string[], i: number) => value.length > 0 ? String(value[i]) : '';
export const arrayModifiers = {
  'join': (value: string[]) => value.join(", "),
  'length': (value: string[]) => value.length.toString(),
  'first': (value: string[]) => arrayModifierGetOrDefault(value, 0),
  'last': (value: string[]) => arrayModifierGetOrDefault(value, value.length - 1),
  'random': (value: string[]) => arrayModifierGetOrDefault(value, Math.floor(Math.random() * value.length)),
  'sort': (value: string[]) => [...value].sort(),
  'reverse': (value: string[]) => [...value].reverse(),
}
          
export const numberModifiers = {
  'comma': (value: number) => value.toLocaleString(),
  'hex': (value: number) => value.toString(16),
  'octal': (value: number) => value.toString(8),
  'binary': (value: number) => value.toString(2),
  'bytes': (value: number) => formatBytes(value, 1000),
  'bytes10': (value: number) => formatBytes(value, 1000),
  'bytes2': (value: number) => formatBytes(value, 1024),
  'string': (value: number) => value.toString(),
  'time': (value: number) => formatDuration(value),
}

export const conditionalModifiers = {
  exact: {
    'istrue': (value: any) => value === true,
    'isfalse': (value: any) => value === false,
    'exists': (value: any) => {
      // Handle null, undefined, empty strings, empty arrays
      if (value === undefined || value === null) return false;
      if (typeof value === 'string') return (value.trim().length > 0 && value != 'null' && value != 'undefined');
      if (Array.isArray(value)) return value.length > 0;
      // For other types (numbers, booleans, objects), consider them as "existing"
      return true;
    },
  },

  // ordering of keys matters here (example: <= should come before < for matching purposes)
  prefix: {
    '$': (value: any, check: any) => value.toLowerCase().startsWith(check.toLowerCase()),
    '^': (value: any, check: any) => value.toLowerCase().endsWith(check.toLowerCase()),
    '~': (value: any, check: any) => value.includes(check),
    '=': (value: any, check: any) => value == check,
    '>=': (value: any, check: any) => value >= check,
    '>': (value: any, check: any) => value > check,
    '<=': (value: any, check: any) => value <= check,
    '<': (value: any, check: any) => value < check,
  },
}

const hardcodedModifiersForRegexMatching = {
  "join('.*?')": null,
  'join(".*?")': null,
  "$\\w+": null,
  "^\\w+": null,
  "~\\w+": null,
  "=\\w+": null,
  ">=\\w+": null,
  ">\\w+": null,
  "<=\\w+": null,
  "<\\w+": null,
}

const modifiers = {
  ...stringModifiers,
  ...numberModifiers,
  ...arrayModifiers,
  ...conditionalModifiers.exact,
  ...conditionalModifiers.prefix,
  ...hardcodedModifiersForRegexMatching,
}

export abstract class BaseFormatter {
  protected config: FormatterConfig;
  protected userData: UserData;

  constructor(config: FormatterConfig, userData: UserData) {
    this.config = config;
    this.userData = userData;
  }

  public format(stream: ParsedStream): { name: string; description: string } {
    const parseValue = this.convertStreamToParseValue(stream);
    return {
      name: this.parseString(this.config.name, parseValue) || '',
      description: this.parseString(this.config.description, parseValue) || '',
    };
  }

  protected convertStreamToParseValue(stream: ParsedStream): ParseValue {
    const languages = stream.parsedFile?.languages || null;
    const userSpecifiedLanguages = [
      ...new Set([
        ...(this.userData.preferredLanguages || []),
        ...(this.userData.requiredLanguages || []),
        ...(this.userData.includedLanguages || []),
      ]),
    ];

    const sortedLanguages = languages
      ? [...languages].sort((a, b) => {
          const aIndex = userSpecifiedLanguages.indexOf(a as any);
          const bIndex = userSpecifiedLanguages.indexOf(b as any);

          const aInUser = aIndex !== -1;
          const bInUser = bIndex !== -1;

          return aInUser && bInUser
            ? aIndex - bIndex
            : aInUser
              ? -1
              : bInUser
                ? 1
                : languages.indexOf(a) - languages.indexOf(b);
        })
      : null;

    const onlyUserSpecifiedLanguages = sortedLanguages?.filter((lang) =>
      userSpecifiedLanguages.includes(lang as any)
    );
    return {
      config: {
        addonName: this.userData.addonName || Env.ADDON_NAME,
      },
      stream: {
        filename: stream.filename || null,
        folderName: stream.folderName || null,
        size: stream.size || null,
        folderSize: stream.folderSize || null,
        library: stream.library !== undefined ? stream.library : null,
        quality: stream.parsedFile?.quality || null,
        resolution: stream.parsedFile?.resolution || null,
        languages: sortedLanguages || null,
        uLanguages: onlyUserSpecifiedLanguages || null,
        languageEmojis: sortedLanguages
          ? sortedLanguages
              .map((lang) => languageToEmoji(lang) || lang)
              .filter((value, index, self) => self.indexOf(value) === index)
          : null,
        uLanguageEmojis: onlyUserSpecifiedLanguages
          ? onlyUserSpecifiedLanguages
              .map((lang) => languageToEmoji(lang) || lang)
              .filter((value, index, self) => self.indexOf(value) === index)
          : null,
        languageCodes: sortedLanguages
          ? sortedLanguages
              .map((lang) => languageToCode(lang) || lang.toUpperCase())
              .filter((value, index, self) => self.indexOf(value) === index)
          : null,
        uLanguageCodes: onlyUserSpecifiedLanguages
          ? onlyUserSpecifiedLanguages
              .map((lang) => languageToCode(lang) || lang.toUpperCase())
              .filter((value, index, self) => self.indexOf(value) === index)
          : null,
        smallLanguageCodes: sortedLanguages
          ? sortedLanguages
              .map((lang) => languageToCode(lang) || lang)
              .filter((value, index, self) => self.indexOf(value) === index)
              .map((code) => makeSmall(code))
          : null,
        uSmallLanguageCodes: onlyUserSpecifiedLanguages
          ? onlyUserSpecifiedLanguages
              .map((lang) => languageToCode(lang) || lang)
              .filter((value, index, self) => self.indexOf(value) === index)
              .map((code) => makeSmall(code))
          : null,
        wedontknowwhatakilometeris: sortedLanguages
          ? sortedLanguages
              .map((lang) => languageToEmoji(lang) || lang)
              .map((emoji) => emoji.replace('🇬🇧', '🇺🇸🦅'))
              .filter((value, index, self) => self.indexOf(value) === index)
          : null,
        uWedontknowwhatakilometeris: onlyUserSpecifiedLanguages
          ? onlyUserSpecifiedLanguages
              .map((lang) => languageToEmoji(lang) || lang)
              .map((emoji) => emoji.replace('🇬🇧', '🇺🇸🦅'))
              .filter((value, index, self) => self.indexOf(value) === index)
          : null,
        visualTags: stream.parsedFile?.visualTags || null,
        audioTags: stream.parsedFile?.audioTags || null,
        releaseGroup: stream.parsedFile?.releaseGroup || null,
        regexMatched: stream.regexMatched?.name || null,
        encode: stream.parsedFile?.encode || null,
        audioChannels: stream.parsedFile?.audioChannels || null,
        indexer: stream.indexer || null,
        seeders: stream.torrent?.seeders ?? null,
        year: stream.parsedFile?.year || null,
        type: stream.type || null,
        title: stream.parsedFile?.title || null,
        season: stream.parsedFile?.season || null,
        seasons: stream.parsedFile?.seasons || null,
        episode: stream.parsedFile?.episode || null,
        seasonEpisode: stream.parsedFile?.seasonEpisode || null,
        duration: stream.duration || null,
        infoHash: stream.torrent?.infoHash || null,
        age: stream.age || null,
        message: stream.message || null,
        proxied: stream.proxied !== undefined ? stream.proxied : null,
      },
      addon: {
        name: stream.addon.name,
        presetId: stream.addon.preset.type,
        manifestUrl: stream.addon.manifestUrl,
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
  }

  protected buildRegexExpression(): RegExp {
    // Dynamically build the `variable` regex pattern from ParseValue keys
    // Futureproof: if we add new keys to ParseValue interface, we must add them here too
    const validVariables: (keyof ParseValue)[] = Object.keys(hardcodedParseValueKeysForRegexMatching) as (keyof ParseValue)[];
    // Get all valid properties (subkeys) from ParseValue structure
    const validProperties = validVariables.flatMap(sectionKey => {
      const section = hardcodedParseValueKeysForRegexMatching[sectionKey as keyof ParseValue];
      if (section && typeof section === 'object' && section !== null) {
        return Object.keys(section);
      }
      return [];
    });
    const variable = `(?<variableName>${validVariables.join('|')})\\.(?<propertyName>${validProperties.join('|')})`;

    // Dynamically build the `modifier` regex pattern from modifier keys
    // Sort by length (longest first) to ensure more specific patterns match before shorter ones
    const validModifiers = Object.keys(modifiers)
      .map(key => key.replace(/[\(\)\'\"\$\^\~\=\>\<]/g, '\\$&'))
      .sort((a, b) => b.length - a.length); // Sort by length, longest first
    
    const modifier = `::(?<mod>${validModifiers.join('|')})`;
    
    // Build the conditional check pattern separately
    // Use [^"]* to capture anything except quotes, making it non-greedy
    const checkTrue = `"(?<mod_check_true>[^"]*)"`;
    const checkFalse = `"(?<mod_check_false>[^"]*)"`;
    const checkTF = `\\[(?<mod_check>${checkTrue}\\|\\|${checkFalse})\\]`;

    // TZ Locale pattern (e.g. 'UTC', 'GMT', 'EST', 'PST', 'en-US', 'en-GB', 'Europe/London', 'America/New_York')
    const modTZLocale = `::(?<mod_tzlocale>[A-Za-z]{2,3}(?:-[A-Z]{2})?|[A-Za-z]+?/[A-Za-z_]+?)`;

    const regexPattern = `\\{${variable}(${modifier})?(${modTZLocale})?(${checkTF})?\\}`;
    
    return new RegExp(regexPattern, 'gi')
  }

  protected parseString(str: string, value: ParseValue): string | null {
    if (!str) return null;

    const replacer = (key: string, value: unknown) => {
      return value;
    };

    const data = { ...value, debug: undefined };

    value.debug = {
      json: JSON.stringify(data, replacer),
      jsonf: JSON.stringify(data, replacer, 2),
    };


    const re = this.buildRegexExpression();
    let matches: RegExpExecArray | null;

    while ((matches = re.exec(str))) {
      if (!matches.groups) continue;

      const index = matches.index as number;

      // Validate - VariableName
      const dataVariable = data[matches.groups.variableName as keyof ParseValue];
      if (!dataVariable) {
        str = this.replaceCharsFromString(
          str,
          '{unknown_variableName}',
          index,
          re.lastIndex
        );
        re.lastIndex = index;
        continue;
      }

      // Validate - PropertyName
      const prop = dataVariable[matches.groups.propertyName as keyof typeof dataVariable];
      if (prop === undefined) {
        str = this.replaceCharsFromString(
          str,
          '{unknown_propertyName}',
          index,
          re.lastIndex
        );
        re.lastIndex = index;
        continue;
      }

      // Validate - Modifier(s)
      if (matches.groups.mod) {
        str = this.replaceCharsFromString(
          str,
          this.modifier(
            matches.groups.mod,
            prop as unknown,
            matches.groups.mod_tzlocale ?? undefined,
            matches.groups.mod_check_true ?? undefined,
            matches.groups.mod_check_false ?? undefined,
            data
          ),
          index,
          re.lastIndex
        );
        re.lastIndex = index;
        continue;
      }

      str = this.replaceCharsFromString(str, prop, index, re.lastIndex);
      re.lastIndex = index;
    }

    return str
      .replace(/\\n/g, '\n')
      .split('\n')
      .filter(
        (line) => line.trim() !== '' && !line.includes('{tools.removeLine}')
      )
      .join('\n')
      .replace(/\{tools.newLine\}/g, '\n');
  }

  protected modifier(
    mod: string,
    value: unknown,
    tzlocale?: string,
    check_true?: string,
    check_false?: string,
    _value?: ParseValue
  ): string {
    const _mod = mod;
    mod = mod.toLowerCase();

    // CONDITIONAL MODIFIERS
    const isExact = Object.keys(conditionalModifiers.exact).includes(mod);
    const isPrefix = Object.keys(conditionalModifiers.prefix).some(key => mod.startsWith(key));
    if (isExact || isPrefix) {
      if (typeof check_true !== 'string' || typeof check_false !== 'string')
        return `{unknown_conditional_modifier_check_true_or_false(${mod})}`;

      // try to coerce true/false value from modifier
      try {
        let conditional: boolean | undefined;

        // EXACT
        if (isExact) {
          const modAsKey = mod as keyof typeof conditionalModifiers.exact;
          conditional = conditionalModifiers.exact[modAsKey](value);
        }
        
        // PREFIX
        else if (isPrefix) {
          for (let key of Object.keys(conditionalModifiers.prefix)) {
            if (mod.startsWith(key)) {
              const checkKey = mod.substring(key.length);
              conditional = conditionalModifiers.prefix[key as keyof typeof conditionalModifiers.prefix](value, checkKey);
              break;
            }
          }
        }

        if (conditional === undefined) return `{unknown_conditional_modifier(${mod})}`;

        if (_value) {
          return conditional
            ? this.parseString(check_true, _value) || check_true
            : this.parseString(check_false, _value) || check_false;
        }
        return conditional ? check_true : check_false;
      } catch (error) {
        return `{unknown_conditional_modifier(${mod})}`;
      }
    }

    // --- STRING MODIFIERS ---
    if (typeof value === 'string') {
      if (mod in stringModifiers) return stringModifiers[mod as keyof typeof stringModifiers](value);
      return `{unknown_str_modifier(${mod})}`;
    }

    // --- ARRAY MODIFIERS ---
    else if (Array.isArray(value)) {
      if (mod in arrayModifiers) {
        const result = arrayModifiers[mod as keyof typeof arrayModifiers](value);
        if (typeof result === 'string') return result;
        return result.join(', ');
      }

      // handle hardcoded modifiers here
      switch (true) {
        case mod.startsWith('join(') && mod.endsWith(')'): {
          // Extract the separator from join(separator)
          // e.g. join(' - ')
          const separator = _mod
            .substring(6, _mod.length - 2)
          return value.join(separator);
        }
      }
      return `{unknown_array_modifier(${mod})}`;
    }

    // --- NUMBER MODIFIERS ---
    else if (typeof value === 'number') {
      if (mod in numberModifiers) return numberModifiers[mod as keyof typeof numberModifiers](value);
      return `{unknown_int_modifier(${mod})}`;
    }

    return `{unknown_modifier(${mod})}`;
  }

  protected replaceCharsFromString(
    str: string,
    replace: string,
    start: number,
    end: number
  ): string {
    return str.slice(0, start) + replace + str.slice(end);
  }
}
