import { ParsedStream, UserData } from '../db/schemas.js';
import * as constants from '../utils/constants.js';
import { createLogger } from '../utils/logger.js';
import {
  formatBytes,
  formatDuration,
  formatHours,
  languageToCode,
  languageToEmoji,
  makeSmall,
} from './utils.js';
import { Env } from '../utils/env.js';

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
    library: boolean;
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
    edition: string | null;
    remastered: boolean;
    repack: boolean;
    uncensored: boolean;
    unrated: boolean;
    upscaled: boolean;
    network: string | null;
    container: string | null;
    extension: string | null;
    indexer: string | null;
    year: string | null;
    title: string | null;
    seasons: number[] | null;
    season: number | null;
    formattedSeasons: string | null;
    episodes: number[] | null;
    episode: number | null;
    formattedEpisodes: string | null;
    seasonEpisode: string[] | null;
    seasonPack: boolean;
    seeders: number | null;
    private: boolean;
    age: string | null;
    ageHours: number | null;
    duration: number | null;
    infoHash: string | null;
    type: string | null;
    message: string | null;
    proxied: boolean;
    seadex: boolean;
    seadexBest: boolean;
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
  } & typeof DebugToolReplacementConstants;
}

/**
 * Pre-compiled function that takes ParseValue and returns formatted string
 */
type CompiledParseFunction = (parseValue: ParseValue) => string;
type CompiledVariableWInsertFn = {
  resultFn: (parseValue: ParseValue) => ResolvedVariable;
  insertIndex: number;
};
/**
 * Pre-compiled function that takes ParseValue and returns `ResolvedVariable` (future: and the variable's context for caching purposes)
 *
 * Retrieves the resolved variable (including modifiers) given a ParseValue (e.g. `stream.cached:istrue` -> `{result: true}` or `stream.languages::istrue` -> `{error: "unknown_array_modifier(istrue)"}`)
 */
type CompiledModifiedVariableFn = (parseValue: ParseValue) => ResolvedVariable;

export abstract class BaseFormatter {
  protected config: FormatterConfig;
  protected userData: UserData;

  private regexBuilder: BaseFormatterRegexBuilder;
  private precompiledNameFunction: CompiledParseFunction | null = null;
  private precompiledDescriptionFunction: CompiledParseFunction | null = null;

  private _compilationPromise: Promise<void>;

  constructor(config: FormatterConfig, userData: UserData) {
    this.config = config;
    this.userData = userData;

    this.regexBuilder = new BaseFormatterRegexBuilder(
      this.convertStreamToParseValue({} as ParsedStream)
    );

    // Start template compilation asynchronously in the background
    this._compilationPromise = this.compileTemplatesAsync();
  }

  private async compileTemplatesAsync(): Promise<void> {
    this.precompiledNameFunction = await this.compileTemplate(this.config.name);
    this.precompiledDescriptionFunction = await this.compileTemplate(
      this.config.description
    );
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
    const languages = stream.parsedFile?.languages || null;
    const userSpecifiedLanguages = [
      ...new Set([
        ...(this.userData.preferredLanguages || []),
        ...(this.userData.requiredLanguages || []),
        ...(this.userData.includedLanguages || []),
      ]),
    ];
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
    const formattedAge = stream.age ? formatHours(stream.age) : null;
    const parseValue: ParseValue = {
      config: {
        addonName: this.userData.addonName || Env.ADDON_NAME,
      },
      stream: {
        filename: stream.filename || null,
        folderName: stream.folderName || null,
        size: stream.size || null,
        folderSize: stream.folderSize || null,
        library: stream.library ?? false,
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
        private: stream.torrent?.private ?? false,
        year: stream.parsedFile?.year || null,
        type: stream.type || null,
        title: stream.parsedFile?.title || null,
        season: stream.parsedFile?.seasons?.[0] || null,
        formattedSeasons: formattedSeasonString || null,
        seasons: stream.parsedFile?.seasons || null,
        episode: stream.parsedFile?.episodes?.[0] || null,
        formattedEpisodes: formattedEpisodeString || null,
        episodes: stream.parsedFile?.episodes || null,
        seasonEpisode: seasonEpisode || null,
        seasonPack: stream.parsedFile?.seasonPack ?? false,
        duration: stream.duration || null,
        infoHash: stream.torrent?.infoHash || null,
        age: formattedAge,
        ageHours: stream.age || null,
        message: stream.message || null,
        proxied: stream.proxied ?? false,
        edition: stream.parsedFile?.edition || null,
        remastered: stream.parsedFile?.remastered ?? false,
        repack: stream.parsedFile?.repack ?? false,
        uncensored: stream.parsedFile?.uncensored ?? false,
        unrated: stream.parsedFile?.unrated ?? false,
        upscaled: stream.parsedFile?.upscaled ?? false,
        network: stream.parsedFile?.network || null,
        container: stream.parsedFile?.container || null,
        extension: stream.parsedFile?.extension || null,
        seadex: (stream.seadex?.isSeadex && !stream.seadex?.isBest) ?? false,
        seadexBest: stream.seadex?.isBest ?? false,
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
    parseValue.debug = {
      ...DebugToolReplacementConstants,
      json: JSON.stringify({ ...parseValue, debug: undefined }),
      jsonf: JSON.stringify(
        { ...parseValue, debug: undefined },
        (_, value) => value,
        2
      ),
    };
    return parseValue;
  }

  protected async compileTemplate(str: string): Promise<CompiledParseFunction> {
    const compiledHelper = await this.compileTemplateHelper(str);
    return (parseValue: ParseValue) => {
      const resultStr = compiledHelper(parseValue);
      // final post-processing of the result string
      return resultStr
        .replace(/\\n/g, '\n')
        .split('\n')
        .filter(
          (line) => line.trim() !== '' && !line.includes('{tools.removeLine}')
        )
        .join('\n')
        .replace(/\{tools.newLine\}/g, '\n');
    };
  }

  protected async compileTemplateHelper(
    str: string
  ): Promise<CompiledParseFunction> {
    const re = this.regexBuilder.buildRegexExpression();
    let matches: RegExpExecArray | null;

    let compiledMatchTemplateFns: CompiledVariableWInsertFn[] = [];

    for (const key in DebugToolReplacementConstants) {
      str = str.replace(
        `{debug.${key}}`,
        DebugToolReplacementConstants[
          key as keyof typeof DebugToolReplacementConstants
        ]
      );
    }

    const placeHolder = ' ';

    // Iterate through all {...} matches
    while ((matches = re.exec(str))) {
      if (!matches.groups) continue;
      const index = matches.index as number;

      // looks like variableType.propertyName(::<modifier|comparator>)* (no timezone or check)
      let matchWithoutSuffix = matches[0].substring(
        1,
        matches[0].length - 1 - (matches.groups.suffix ?? '').length
      );

      // Split {<var1_with_modifiers>>::<comparator1>::<var2_with_modifiers>>...} into variableWithModifiers array and comparators array
      const splitOnComparators = matchWithoutSuffix.split(
        RegExp(this.regexBuilder.buildComparatorRegexPattern(), 'gi')
      );
      const variableWithModifiers = splitOnComparators.filter(
        (_, i) => i % 2 == 0
      );
      const comparators = splitOnComparators.filter((_, i) => i % 2 != 0);
      const foundComparators = comparators.map(
        (c) => c as keyof typeof ComparatorConstants.comparatorKeyToFuncs
      );
      let precompiledResolvedVariableFns: CompiledModifiedVariableFn[] =
        variableWithModifiers.map((baseString) =>
          this.parseModifiedVariable(baseString, {
            mod_tzlocale: matches?.groups?.mod_tzlocale ?? undefined,
          })
        );

      // COMPARATOR logic: compare all ResolvedVariables against each other to make one ResolvedVariable (as precompiled wrapper function (parseValue) => ResolvedVariable)
      let precompiledResolvedVariableFn = (
        parseValue: ParseValue
      ): ResolvedVariable => {
        if (precompiledResolvedVariableFns.length == 1)
          return precompiledResolvedVariableFns[0](parseValue);

        // Check if we can safely use short-circuit evaluation
        // Only short-circuit when all operators are the same type (all 'and' or all 'or')
        const allOperatorsSame = foundComparators.every(
          (op, idx, arr) => op === arr[0]
        );
        const canShortCircuit =
          allOperatorsSame &&
          (foundComparators[0] === 'and' || foundComparators[0] === 'or');

        // Use lazy evaluation with short-circuit logic for AND/OR operations when safe
        let result: ResolvedVariable =
          precompiledResolvedVariableFns[0](parseValue);

        for (let i = 1; i < precompiledResolvedVariableFns.length; i++) {
          // If previous result has error, propagate it
          if (result.error !== undefined) return result;

          const compareKey = foundComparators[
            i - 1
          ] as keyof typeof ComparatorConstants.comparatorKeyToFuncs;

          // Short-circuit evaluation only when all operators are the same
          if (canShortCircuit) {
            if (compareKey === 'and' && result.result === false) {
              return { result: false };
            } else if (compareKey === 'or' && result.result === true) {
              return { result: true };
            }
          }

          const nextResolved = precompiledResolvedVariableFns[i](parseValue);

          // If next result has error, propagate it
          if (nextResolved.error !== undefined) return nextResolved;

          const comparatorFn =
            ComparatorConstants.comparatorKeyToFuncs[compareKey];

          try {
            result = {
              result: comparatorFn(result.result, nextResolved.result),
            };
          } catch (e) {
            return {
              error: `{unable_to_compare(<${result.result}>::${compareKey}::<${nextResolved.result}>, ${e})}`,
            };
          }
        }

        return result;
      }; // end of COMPARATOR logic

      // CHECK TRUE/FALSE logic: compile the true/false templates and apply them to the resolved variable
      if (matches.groups.mod_check !== undefined) {
        const check_trueFn = await this.compileTemplateHelper(
          matches?.groups?.mod_check_true ?? ''
        );
        const check_falseFn = await this.compileTemplateHelper(
          matches?.groups?.mod_check_false ?? ''
        );

        const _compiledResolvedVariableFn = precompiledResolvedVariableFn;
        precompiledResolvedVariableFn = (
          parseValue: ParseValue
        ): ResolvedVariable => {
          const resolved = _compiledResolvedVariableFn(parseValue);
          if (![true, false].includes(resolved.result)) {
            return {
              error: `{cannot_coerce_boolean_for_check_from(${resolved.result})}`,
            };
          }
          return {
            result: resolved.result
              ? check_trueFn(parseValue)
              : check_falseFn(parseValue),
          };
        };
      } // end of CHECK TRUE/FALSE logic

      str = str.slice(0, index) + placeHolder + str.slice(re.lastIndex);
      re.lastIndex = index + placeHolder.length;
      compiledMatchTemplateFns.push({
        resultFn: precompiledResolvedVariableFn,
        insertIndex: index,
      });
    } // end of while loop

    compiledMatchTemplateFns = compiledMatchTemplateFns.sort(
      (a, b) => b.insertIndex - a.insertIndex
    );
    return (parseValue: ParseValue) => {
      let resultStr = str;

      // Sort by startIndex to process in reverse order
      for (const { resultFn, insertIndex } of compiledMatchTemplateFns) {
        const resolvedResult = resultFn(parseValue);
        const replacement =
          resolvedResult.error ?? resolvedResult.result?.toString() ?? '';
        resultStr =
          resultStr.slice(0, insertIndex) +
          replacement +
          resultStr.slice(insertIndex + placeHolder.length);
      }

      return resultStr;
    };
  }

  /**
   * @param baseString - string to parse, e.g. `<variableType>.<propertyName>(::<modifier>)*`
   * @param value - ParseValue object
   * @param fullStringModifiers - modifiers that are applied to the entire string (e.g. `::<tzLocale>`)
   *
   * @returns (parseValue) => `{ result: <resolved modified variable> }` or `{ error: "<errorMessage>" }`
   */
  protected parseModifiedVariable(
    baseString: string,
    fullStringModifiers: {
      mod_tzlocale: string | undefined;
    }
  ): CompiledModifiedVariableFn {
    // get variableType and propertyName from baseString without regex
    const variableType = baseString.split('.')[0];
    baseString = baseString.substring(variableType.length + 1);
    const propertyName = baseString.split('::')[0];
    const allModifiers = baseString.substring(propertyName.length);
    let sortedModMatches: string[] = [];
    if (allModifiers.length) {
      const singleModTerminator = '(?=::|$)'; // :: if there's multiple modifiers, or $ for the end of the string
      const singleValidModRe = new RegExp(
        `${this.regexBuilder.buildModifierRegexPattern()}${singleModTerminator}`,
        'g'
      );

      sortedModMatches = [...allModifiers.matchAll(singleValidModRe)]
        .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
        .map(
          (regExpExecArray) =>
            regExpExecArray[1] /* First capture group, aka the modifier name */
        );
    }

    return (parseValue: ParseValue) => {
      // PARSE VARIABLE logic
      const variableDict = parseValue[variableType as keyof ParseValue];
      if (!variableDict)
        return { error: `{unknown_variableType(${variableType})}` }; // should never happen
      const property = variableDict![
        propertyName as keyof typeof variableDict
      ] as any;
      if (property === undefined)
        return {
          error: `{unknown_propertyName(${variableType}.${propertyName})}`,
        }; // should never happen
      // end of PARSE VARIABLE logic

      // APPLY MULTIPLE MODIFIERS logic
      let result = property;
      for (const lastModMatched of sortedModMatches) {
        result = this.applySingleModifier(
          result,
          lastModMatched,
          fullStringModifiers
        );
        if (result === undefined) {
          let getErrorResult = () => {
            switch (typeof property) {
              case 'string':
              case 'number':
              case 'boolean':
                return {
                  error: `{unknown_${typeof property}_modifier(${lastModMatched})}`,
                };
              case 'object':
                if (property == null) {
                  return {
                    error: `{cannot_apply_modifier_to_null(${lastModMatched})}`,
                  };
                }
                return { error: `{unknown_array_modifier(${lastModMatched})}` };
              default:
                return { error: `{unknown_modifier(${lastModMatched})}` };
            }
          };
          return getErrorResult();
        }
      }
      // end of APPLY MULTIPLE MODIFIERS logic

      return { result: result } as ResolvedVariable;
    };
  }

  /**
   * @param variable - the variable to apply the modifier to (e.g. `123`, `"TorBox"`, `["English", "Italian"]`, etc.)
   * @param mod - the modifier to apply
   * @param fullStringModifiers - modifiers that are applied to the entire string (e.g. `::<tzLocale>`)
   * @returns `{ result: <resolved modified variable> }` or `{ error: "<errorMessage>" }`
   */
  protected applySingleModifier(
    variable: any,
    mod: string,
    fullStringModifiers: {
      mod_tzlocale: string | undefined;
    }
  ): string | boolean | undefined {
    const _mod = mod;
    mod = mod.toLowerCase();

    // CONDITIONAL MODIFIERS
    const isExact = Object.keys(
      ModifierConstants.conditionalModifiers.exact
    ).includes(mod);
    const isPrefix = Object.keys(
      ModifierConstants.conditionalModifiers.prefix
    ).some((key) => mod.startsWith(key));
    if (isExact || isPrefix) {
      // try to coerce true/false value from modifier
      let conditional: boolean | undefined;
      try {
        // PRE-CHECK(s) -- skip resolving conditional modifier if value DNE, defaulting to false conditional
        if (!ModifierConstants.conditionalModifiers.exact.exists(variable)) {
          conditional = false;
        }

        // EXACT
        else if (isExact) {
          const modAsKey =
            mod as keyof typeof ModifierConstants.conditionalModifiers.exact;
          conditional =
            ModifierConstants.conditionalModifiers.exact[modAsKey](variable);
        }

        // PREFIX
        else if (isPrefix) {
          // get the longest prefix match
          const modPrefix = Object.keys(
            ModifierConstants.conditionalModifiers.prefix
          )
            .sort((a, b) => b.length - a.length)
            .find((key) => mod.startsWith(key))!!;

          // Pre-process string value and check to allow for intuitive comparisons
          const stringValue = variable.toString().toLowerCase();
          let stringCheck = mod.substring(modPrefix.length).toLowerCase();
          // remove whitespace from stringCheck if it isn't in stringValue
          stringCheck = !/\s/.test(stringValue)
            ? stringCheck.replace(/\s/g, '')
            : stringCheck;

          // parse value/check as if they're numbers (123,456 -> 123456)
          const [parsedNumericValue, parsedNumericCheck] = [
            Number(stringValue.replace(/,\s/g, '')),
            Number(stringCheck.replace(/,\s/g, '')),
          ];
          const isNumericComparison =
            ['<', '<=', '>', '>=', '='].includes(modPrefix) &&
            !isNaN(parsedNumericValue) &&
            !isNaN(parsedNumericCheck);

          conditional = ModifierConstants.conditionalModifiers.prefix[
            modPrefix as keyof typeof ModifierConstants.conditionalModifiers.prefix
          ](
            isNumericComparison ? (parsedNumericValue as any) : stringValue,
            isNumericComparison ? (parsedNumericCheck as any) : stringCheck
          );
        }
      } catch (error) {
        conditional = false;
      }
      return conditional;
    }

    // --- STRING MODIFIERS ---
    else if (typeof variable === 'string') {
      if (mod in ModifierConstants.stringModifiers)
        return ModifierConstants.stringModifiers[
          mod as keyof typeof ModifierConstants.stringModifiers
        ](variable);

      // handle hardcoded modifiers here
      switch (true) {
        case mod.startsWith('replace(') && mod.endsWith(')'): {
          const findStartChar = mod.charAt(8); // either " or '
          const findEndChar = mod.charAt(mod.length - 2); // either " or '

          // Extract the separator from replace(['"]...<matching'">, ['"]...<matching'">)
          const content = _mod.substring(9, _mod.length - 2);

          // split on findStartChar<whitespace?>,<whitespace?>findEndChar
          const [key, replaceKey, shouldBeUndefined] = content.split(
            new RegExp(`${findStartChar}\\s*,\\s*${findEndChar}`)
          );

          if (!shouldBeUndefined && key && replaceKey)
            return variable.replaceAll(key, replaceKey);
        }
        case mod.startsWith('truncate(') && mod.endsWith(')'): {
          // Extract N from truncate(N)
          const inside = _mod.substring('truncate('.length, _mod.length - 1);
          const n = parseInt(inside, 10);
          if (!isNaN(n) && n >= 0) {
            if (variable.length > n) {
              // Truncate to N characters and remove trailing whitespace
              const truncated = variable.slice(0, n).replace(/\s+$/, '');
              return truncated + '…';
            }
            return variable;
          }
        }
      }
    }

    // --- ARRAY MODIFIERS ---
    else if (Array.isArray(variable)) {
      if (mod in ModifierConstants.arrayModifiers)
        return ModifierConstants.arrayModifiers[
          mod as keyof typeof ModifierConstants.arrayModifiers
        ](variable)?.toString();

      // handle hardcoded modifiers here
      switch (true) {
        case mod.startsWith('join(') && mod.endsWith(')'): {
          // Extract the separator from join('separator') or join("separator")
          const separator = _mod.substring(6, _mod.length - 2);
          return variable.join(separator);
        }
      }
    }

    // --- NUMBER MODIFIERS ---
    else if (typeof variable === 'number') {
      if (mod in ModifierConstants.numberModifiers)
        return ModifierConstants.numberModifiers[
          mod as keyof typeof ModifierConstants.numberModifiers
        ](variable);
    }

    return undefined;
  }
}

/**
 * Used to store the actual value of a parsed, and potentially modified, variable
 * or an error message if the parsed/modified result becomes invalid for any reason
 */
type ResolvedVariable = {
  result?: any;
  error?: string | undefined;
};

class BaseFormatterRegexBuilder {
  private hardcodedParseValueKeysForRegexMatching: ParseValue;
  constructor(hardcodedParseValueKeysForRegexMatching: ParseValue) {
    this.hardcodedParseValueKeysForRegexMatching =
      hardcodedParseValueKeysForRegexMatching;
  }
  /**
   * RegEx Capture Pattern: `<variableType>.<propertyName>`
   *
   * (no named capture group)
   */
  public buildVariableRegexPattern(): string {
    // Get all valid variable names (keys as well as subkeys) from ParseValue structure
    const validVariableNames = Object.keys(
      this.hardcodedParseValueKeysForRegexMatching
    ).flatMap((sectionKey) => {
      const section =
        this.hardcodedParseValueKeysForRegexMatching[
          sectionKey as keyof ParseValue
        ];
      if (section && typeof section === 'object' && section !== null) {
        return Object.keys(section).map((key) => `${sectionKey}\\.${key}`);
      }
      return []; // @flatMap
    });
    return `(${validVariableNames.join('|')})`;
  }
  /**
   * RegEx Capture Pattern: `::<modifier>`
   *
   * (no named capture group)
   */
  public buildModifierRegexPattern(): string {
    const validModifiers = Object.keys(ModifierConstants.modifiers).map((key) =>
      key.replace(/[\(\)\'\"\$\^\~\=\>\<]/g, '\\$&')
    );
    return `::(${validModifiers.join('|')})`;
  }
  /**
   * RegEx Capture Pattern: `::<comparator>::`
   *
   * (no named capture group)
   */
  public buildComparatorRegexPattern(): string {
    const comparatorKeys = Object.keys(
      ComparatorConstants.comparatorKeyToFuncs
    );
    return `::(${comparatorKeys.join('|')})::`;
  }
  /**
   * RegEx Capture Pattern: `::<tzLocale>`
   *
   * (with named capture group `tzLocale`)
   */
  public buildTZLocaleRegexPattern(): string {
    // TZ Locale pattern (e.g. 'UTC', 'GMT', 'EST', 'PST', 'en-US', 'en-GB', 'Europe/London', 'America/New_York')
    return `::(?<mod_tzlocale>[A-Za-z]{2,3}(?:-[A-Z]{2})?|[A-Za-z]+?/[A-Za-z_]+?)`;
  }
  /**
   * RegEx Capture Pattern: `["<check_true>||<check_false>"]`
   *
   * (with named capture group `<mod_check_true>` and `<mod_check_false>` and `mod_check`=`"<check_true>||<check_false>"`)
   */
  public buildCheckRegexPattern(): string {
    // Build the conditional check pattern separately
    // Use [^"]* to capture anything except quotes, making it non-greedy
    const checkTrue = `"(?<mod_check_true>[^"]*)"`;
    const checkFalse = `"(?<mod_check_false>[^"]*)"`;
    return `\\[(?<mod_check>${checkTrue}\\|\\|${checkFalse})\\]`;
  }
  /**
   * RegEx Captures: `{ <singleModifiedVariable> (::<comparator>::<singleModifiedVariable>)* (<tz>?) (<[t||f]>?) }`
   */
  public buildRegexExpression(): RegExp {
    const variable = this.buildVariableRegexPattern();
    const modifier = this.buildModifierRegexPattern();
    const comparator = this.buildComparatorRegexPattern();
    const modTZLocale = this.buildTZLocaleRegexPattern();
    const checkTF = this.buildCheckRegexPattern();

    const variableAndModifiers = `${variable}(${modifier})*`;
    const regexPattern = `\\{${variableAndModifiers}(${comparator}${variableAndModifiers})*(?<suffix>(${modTZLocale})?(${checkTF})?)\\}`;

    return new RegExp(regexPattern, 'gi');
  }
}

/**
 * Static Constants
 */
class ModifierConstants {
  static stringModifiers = {
    upper: (value: string) => value.toUpperCase(),
    lower: (value: string) => value.toLowerCase(),
    title: (value: string) =>
      value
        .split(' ')
        .map((word) => word.toLowerCase())
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' '),
    length: (value: string) => value.length.toString(),
    reverse: (value: string) => value.split('').reverse().join(''),
    base64: (value: string) => btoa(value),
    string: (value: string) => value,
  };

  static arrayModifierGetOrDefault = (value: string[], i: number) =>
    value.length > 0 ? String(value[i]) : '';
  static arrayModifiers = {
    join: (value: string[]) => value.join(', '),
    length: (value: string[]) => value.length.toString(),
    first: (value: string[]) => this.arrayModifierGetOrDefault(value, 0),
    last: (value: string[]) =>
      this.arrayModifierGetOrDefault(value, value.length - 1),
    random: (value: string[]) =>
      this.arrayModifierGetOrDefault(
        value,
        Math.floor(Math.random() * value.length)
      ),
    sort: (value: string[]) => [...value].sort(),
    reverse: (value: string[]) => [...value].reverse(),
  };

  static numberModifiers = {
    comma: (value: number) => value.toLocaleString(),
    hex: (value: number) => value.toString(16),
    octal: (value: number) => value.toString(8),
    binary: (value: number) => value.toString(2),
    bytes: (value: number) => formatBytes(value, 1000),
    rbytes: (value: number) => formatBytes(value, 1000, true),
    bytes10: (value: number) => formatBytes(value, 1000),
    rbytes10: (value: number) => formatBytes(value, 1000, true),
    bytes2: (value: number) => formatBytes(value, 1024),
    rbytes2: (value: number) => formatBytes(value, 1024, true),
    string: (value: number) => value.toString(),
    time: (value: number) => formatDuration(value),
  };

  static conditionalModifiers = {
    exact: {
      istrue: (value: any) => value === true,
      isfalse: (value: any) => value === false,
      exists: (value: any) => {
        // Handle null, undefined, empty strings, empty arrays
        if (value === undefined || value === null) return false;
        if (typeof value === 'string') return /\S/.test(value); // has at least one non-whitespace character
        if (Array.isArray(value)) return value.length > 0;
        // For other types (numbers, booleans, objects), consider them as "existing"
        return true;
      },
    },

    prefix: {
      $: (value: string, check: string) => value.startsWith(check),
      '^': (value: string, check: string) => value.endsWith(check),
      '~': (value: string, check: string) => value.includes(check),
      '=': (value: string, check: string) => value == check,
      '>=': (value: string | number, check: string | number) => value >= check,
      '>': (value: string | number, check: string | number) => value > check,
      '<=': (value: string | number, check: string | number) => value <= check,
      '<': (value: string | number, check: string | number) => value < check,
    },
  };

  static hardcodedModifiersForRegexMatching = {
    "replace('.*?'\\s*?,\\s*?'.*?')": null,
    'replace(".*?"\\s*?,\\s*?\'.*?\')': null,
    'replace(\'.*?\'\\s*?,\\s*?".*?")': null,
    'replace(".*?"\\s*?,\\s*?\".*?\")': null,
    "join('.*?')": null,
    'join(".*?")': null,
    'truncate(\\d+)': null,
    '$.*?': null,
    '^.*?': null,
    '~.*?': null,
    '=.*?': null,
    '>=.*?': null,
    '>.*?': null,
    '<=.*?': null,
    '<.*?': null,
  };

  static modifiers = {
    ...this.hardcodedModifiersForRegexMatching,
    ...this.stringModifiers,
    ...this.numberModifiers,
    ...this.arrayModifiers,
    ...this.conditionalModifiers.exact,
    ...this.conditionalModifiers.prefix,
  };
}

class ComparatorConstants {
  static comparatorKeyToFuncs = {
    and: (v1: any, v2: any) => v1 && v2,
    or: (v1: any, v2: any) => v1 || v2,
    xor: (v1: any, v2: any) => (v1 || v2) && !(v1 && v2),
    neq: (v1: any, v2: any) => v1 !== v2,
    equal: (v1: any, v2: any) => v1 === v2,
    left: (v1: any, _: any) => v1,
    right: (_: any, v2: any) => v2,
  };
}

const DebugToolReplacementConstants = {
  modifier: `
String: {config.addonName}
  ::upper {config.addonName::upper}
  ::lower {config.addonName::lower}
  ::title {config.addonName::title}
  ::length {config.addonName::length}
  ::reverse {config.addonName::reverse}
{tools.newLine}

Number: {stream.size}
  ::bytes {stream.size::bytes}
  ::time {stream.size::time}
  ::hex {stream.size::hex}
  ::octal {stream.size::octal}
  ::binary {stream.size::binary}
{tools.newLine}

Array: {stream.languages}
  ::join('-separator-') {stream.languages::join("-separator-")}
  ::length {stream.languages::length}
  ::first {stream.languages::first}
  ::last {stream.languages::last}
{tools.newLine}

Conditional:
  String: {stream.filename}
    filename::exists    {stream.filename::exists["true"||"false"]}
    filename::$Movie    {stream.filename::$Movie["true"||"false"]}
    filename::^mkv    {stream.filename::^mkv["true"||"false"]}
    filename::~Title     {stream.filename::~Title["true"||"false"]}
    filename::=test     {stream.filename::=test["true"||"false"]}
  Number: {stream.size}
    filesize::>=100     {stream.size::>=100["true"||"false"]}
    filesize::>50       {stream.size::>50["true"||"false"]}
    filesize::<=200     {stream.size::<=200["true"||"false"]}
    filesize::<150      {stream.size::<150["true"||"false"]}
  Boolean: {stream.proxied}
    ::istrue {stream.proxied::istrue["true"||"false"]}
    ::isfalse {stream.proxied::isfalse["true"||"false"]}
{tools.newLine}

[Advanced] Multiple modifiers
  <string>::reverse::title::reverse   {config.addonName} -> {config.addonName::reverse::title::reverse}
  <number>::string::reverse           {stream.size} -> {stream.size::string::reverse}
  <array>::string::reverse            {stream.languages} -> {stream.languages::join("::")::reverse}
  <boolean>::length::>=2              {stream.languages} -> {stream.languages::length::>=2["true"||"false"]}
`,

  comparator: `
Comparators: <stream.library({stream.library})>::comparator::<stream.proxied({stream.proxied})>
  ::and:: {stream.library::and::stream.proxied["true"||"false"]}
  ::or:: {stream.library::or::stream.proxied["true"||"false"]}
  ::xor:: {stream.library::xor::stream.proxied["true"||"false"]}
  ::neq:: {stream.library::neq::stream.proxied["true"||"false"]}
  ::equal:: {stream.library::equal::stream.proxied["true"||"false"]}
  ::left:: {stream.library::left::stream.proxied["true"||"false"]}
  ::right:: {stream.library::right::stream.proxied["true"||"false"]}
{tools.newLine}

[Advanced] Multiple Comparators
  Is English
    stream.languages::~English::or::stream.languages::~dub::and::stream.languages::length::>0["Yes"||"Unknown"]  ->  {stream.languages::~English::or::stream.languages::~dub::and::stream.languages::length::>0["Yes"||"Unknown"]}
  Is Fast Enough Link
    service.cached::or::stream.library::or::stream.seeders::>10["true"||"false"]  ->  {service.cached::istrue::or::stream.library::or::stream.seeders::>10["true"||"false"]}
`,
};
