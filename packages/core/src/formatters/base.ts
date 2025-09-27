import { ParsedStream, UserData } from '../db/schemas.js';
import * as constants from '../utils/constants.js';
import { createLogger } from '../utils/logger.js';
import {
  formatBytes,
  formatDuration,
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
    name: string | null;
    presetId: string | null;
    manifestUrl: string | null;
  };
  debug?: {
    json: string | null;
    jsonf: string | null;
  } & typeof DebugToolReplacementConstants;
  tools: {
    removeline: string;
    newline: string;
  };
}

/**
 * Pre-compiled function that takes ParseValue and returns formatted string
 */
type ParseValueToString = (parseValue: ParseValue) => string;
/**
 * Pre-compiled function that takes ParseValue and returns `ResolvedVariable`
 *
 * Retrieves the resolved variable (including modifiers) given a ParseValue (e.g. `stream.cached:istrue` -> `{result: true}` or `stream.languages::istrue` -> `{error: "unknown_array_modifier(istrue)"}`)
 */
type ParseValueToVariable = (parseValue: ParseValue) => ResolvedVariable;

export abstract class BaseFormatter {
  protected config: FormatterConfig;
  protected userData: UserData;

  private regexBuilder: BaseFormatterRegexBuilder;
  private precompiledNameFunction: ParseValueToString | null = null;
  private precompiledDescriptionFunction: ParseValueToString | null = null;

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
    // Compile both templates in parallel for better performance
    const [nameFunction, descriptionFunction] = await Promise.all([
      this.compileTemplate(this.config.name),
      this.compileTemplate(this.config.description)
    ]);
    
    this.precompiledNameFunction = nameFunction;
    this.precompiledDescriptionFunction = descriptionFunction;
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
    const parseValue: ParseValue = {
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
      tools: {
        removeline: '{tools.removeline}',
        newline: '{tools.newline}',
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

  protected async compileTemplate(str: string): Promise<ParseValueToString> {
    // Pre-process: replace all debug keys with their values
    for (const key in DebugToolReplacementConstants) {
      str = str.replace(
        `{debug.${key}}`,
        DebugToolReplacementConstants[
          key as keyof typeof DebugToolReplacementConstants
        ]
      );
    }

    const process = await this.compileTemplateHelper(str);
    // process & post-process the template
    return (parseValue: ParseValue) =>
      process(parseValue)
        .replace(/\\n/g, '\n')
        .split('\n')
        .filter(
          (line) => line.trim() !== '' && !line.includes('{tools.removeline}')
        )
        .join('\n')
        .replace(/\{tools.newline\}/g, '\n');
  }
  protected async compileTemplateHelper(
    str: string
  ): Promise<ParseValueToString> {
    if (!str) return () => '';

    let compiledVariableTemplateFns: {
      resultFn: ParseValueToVariable;
      insertedIndex: number;
    }[] = [];
    const PLACEHOLDER = 'X'; // any string of length > 0

    // go through the string manually to find all valid variables (allows infinitely nested variables)
    const re = this.regexBuilder.buildRegexExpression();
    let leftBracketIndices: number[] = [];
    /**
     * Iterate through the string and find all valid variable templates (nested variables FIRST as their ending comes first)
     */
    let i = -1;
    while (++i < str.length) {
      if (!['{', '}'].includes(str[i])) continue;

      if (str[i] === '{') {
        leftBracketIndices.push(i);
        continue;
      } else if (str[i] === '}' && leftBracketIndices.length == 0) continue; // found `}` without a matching `{` -> ignore as it's not a valid variable

      // str[i] === '}'
      const getMatches = () => {
        for (let j = leftBracketIndices.length - 1; j >= 0; j--) {
          // test if THIS `{...}` is a valid variable
          const potentialVariableTemplate = str.slice(
            leftBracketIndices[j],
            i + 1
          );
          const matches = potentialVariableTemplate
            .replace(/\s+/g, '') // allow for whitespace in the variable
            .match(re);

          // check to see if `{...}` string (with whitespace removed) is a valid variableTemplate
          if (matches?.groups) {
            // CHECK TRUE/FALSE logic
            const checkTF = potentialVariableTemplate.match(
              /\[\s*"(?<mod_check_true>.*?)"\s*\|\s*\|\s*"(?<mod_check_false>.*?)"\s*\]\s*\}$/
            );
            const modCheck = checkTF?.groups && {
              true: checkTF?.groups?.mod_check_true,
              false: checkTF?.groups?.mod_check_false,
            };
            const relativeTrueIndex =
              checkTF?.[0].indexOf(`"${modCheck?.true}"`)! + `"`.length;
            const relativeFalseIndex =
              checkTF?.[0].lastIndexOf(`"${modCheck?.false}"`)! + `"`.length;
            const modCheckWithOffsets = modCheck && {
              ...modCheck,
              offsetFromVariable: relativeTrueIndex,
              offsetFromTrueCase:
                relativeFalseIndex - (relativeTrueIndex + modCheck.true.length),
            }; // end of CHECK TRUE/FALSE

            return {
              leftBracketIndex: leftBracketIndices.splice(j, 1)[0],
              variableTemplateWhitespace: potentialVariableTemplate.slice(
                `{`.length,
                -`${checkTF?.[0] ?? '}'}`.length
              ),
              suffixModifiers: {
                mod_check: modCheckWithOffsets,
                mod_tzlocale: matches.groups?.mod_tzlocale,
              },
            };
          }
        }
        return null;
      };
      const matchesData = getMatches();
      if (!matchesData) continue;
      const { leftBracketIndex, variableTemplateWhitespace } = matchesData;
      let { suffixModifiers: globalSuffixModifiers } = matchesData;

      // REMOVE WHITESPACE from variableTemplate
      let globalVariableTemplate = variableTemplateWhitespace
        .split(
          new RegExp(`(${this.regexBuilder.buildComparatorRegexPattern()})`)
        )
        .map((singleVariableTemplate) => {
          const singleVariableTemplateByModifiers =
            singleVariableTemplate.split(
              new RegExp(`(${this.regexBuilder.buildModifierRegexPattern()})`)
            );
          singleVariableTemplateByModifiers[0] =
            singleVariableTemplateByModifiers[0].replace(/\s+/g, '');
          return singleVariableTemplateByModifiers
            .map((v) => v.trim())
            .join('');
        })
        .join('');

      // get the number of whitespace removed before each index
      let numWhitespaceRemovedBeforeN: Record<number, number> = {};
      let numWhitespaceRemoved = 0;
      let m = 0; // iterate through variableTemplate
      for (let n = 0; n < variableTemplateWhitespace.length; n++) {
        if (
          m >= globalVariableTemplate.length ||
          globalVariableTemplate[m] != variableTemplateWhitespace[n]
        )
          numWhitespaceRemoved++;
        else m++;
        numWhitespaceRemovedBeforeN[n] = numWhitespaceRemoved;
      }
      // end of REMOVE WHITESPACE

      const checkSuffix = globalSuffixModifiers.mod_check
        ? '_'.repeat(globalSuffixModifiers.mod_check.offsetFromVariable) +
          `${globalSuffixModifiers.mod_check.true}${'_'.repeat(globalSuffixModifiers.mod_check.offsetFromTrueCase)}${globalSuffixModifiers.mod_check.false}"]`
        : '';
      const nestedVariablesWIndices = compiledVariableTemplateFns
        .filter(
          (fn) =>
            leftBracketIndex < fn.insertedIndex &&
            fn.insertedIndex <
              leftBracketIndex +
                `{${variableTemplateWhitespace}${checkSuffix}}`.length
        )
        .reverse();
      const getResolvedVariable = (parseValue: ParseValue) => {
        // Create local copies to avoid mutating shared state across format() calls
        let variableTemplate = globalVariableTemplate;
        let suffixModifiers = {
          mod_check: globalSuffixModifiers.mod_check ? {
            ...globalSuffixModifiers.mod_check,
          } : undefined,
          mod_tzlocale: globalSuffixModifiers.mod_tzlocale,
        };

        // NESTED VARIABLES - if any nested variables exist within this variable template, they need to be replaced with their resolved values
        nestedVariablesWIndices.forEach(({ resultFn, insertedIndex }) => {
          const relativeInsertIndex = insertedIndex - leftBracketIndex;
          const resolvedVariable = resultFn(parseValue);
          const resolved =
            resolvedVariable.error ?? resolvedVariable.result?.toString() ?? '';
          const addResolvedVariable = (str: string, startIndex: number) =>
            str.slice(0, startIndex) +
            resolved +
            str.slice(startIndex + PLACEHOLDER.length);

          // nested variable NEW positions must account for the whitespace when they were originally replaced by plaeholder
          const trueCaseOffset = suffixModifiers.mod_check
            ? `{${variableTemplateWhitespace}`.length +
              suffixModifiers.mod_check.offsetFromVariable
            : 0;
          const falseCaseOffset = suffixModifiers.mod_check
            ? trueCaseOffset +
              suffixModifiers.mod_check.true.length +
              suffixModifiers.mod_check.offsetFromTrueCase
            : 0;

          if (
            suffixModifiers.mod_check &&
            relativeInsertIndex >= falseCaseOffset
          ) {
            // false check case
            suffixModifiers.mod_check.false = addResolvedVariable(
              suffixModifiers.mod_check.false,
              relativeInsertIndex - falseCaseOffset
            );
          } else if (
            suffixModifiers.mod_check &&
            relativeInsertIndex >= trueCaseOffset
          ) {
            // true check case
            suffixModifiers.mod_check.true = addResolvedVariable(
              suffixModifiers.mod_check.true,
              relativeInsertIndex - trueCaseOffset
            );
          } else {
            // variableTemplate case
            variableTemplate = addResolvedVariable(
              variableTemplate,
              relativeInsertIndex -
                numWhitespaceRemovedBeforeN[relativeInsertIndex]
            );
          }
        }); // end of NESTED VARIABLES

        // process the variableTemplate (in it's final processable state)
        return this.parseVariable(variableTemplate, {
          mod_check: suffixModifiers.mod_check
            ? {
                true: suffixModifiers.mod_check.true,
                false: suffixModifiers.mod_check.false,
              }
            : undefined,
          mod_tzlocale: suffixModifiers.mod_tzlocale,
        })(parseValue);
      };

      compiledVariableTemplateFns = compiledVariableTemplateFns.filter(
        (fn) => !nestedVariablesWIndices.includes(fn)
      );
      compiledVariableTemplateFns.push({
        resultFn: getResolvedVariable, // compile the current variableTemplate into a (parseValue) => ResolvedVariable
        insertedIndex: leftBracketIndex,
      });
      str = str.slice(0, leftBracketIndex) + PLACEHOLDER + str.slice(i + 1); // remove {...} entirely and replace with placeholder
      i = leftBracketIndex + PLACEHOLDER.length - 1; // start immediately after the placeholder (remove one for ++i setting in while loop)
    } // end of WHILE LOOP to find all valid variableTemplate(s) / matches

    // For all compiled variableTemplates, parse them into one single compiled string
    return (parseValue: ParseValue) => {
      let resultStr = str;

      for (const {
        resultFn,
        insertedIndex,
      } of [...compiledVariableTemplateFns].reverse()) {
        const resolvedResult = resultFn(parseValue);
        const replacement =
          resolvedResult.error ?? resolvedResult.result?.toString() ?? '';
        resultStr =
          resultStr.slice(0, insertedIndex) +
          replacement +
          resultStr.slice(insertedIndex + PLACEHOLDER.length);
      }
      return resultStr;
    };
  }

  /**
   * @param modifiedVariable - allowed variable string: `{<var>(::<modifier>)*(::<comparator>::<var>::<modifier>)*(tz)?([true||false])?}`
   * @param mod_check - the check suffix (e.g. `["<true_case>||<false_case>"]`)
   * @returns (parseValue) => ResolvedVariable
   */
  protected parseVariable(
    modifiedVariable: string,
    fullStringModifiers: FullStringModifiers
  ): (parseValue: ParseValue) => ResolvedVariable {
    // Split <var1_with_modifiers>>::<comparator1>::<var2_with_modifiers>>... into variableWithModifiers array and comparators array
    const splitOnComparators = modifiedVariable.split(
      RegExp(`(${this.regexBuilder.buildComparatorRegexPattern()})`, 'gi')
    );
    const variableWithModifiers = splitOnComparators.filter(
      (_, i) => i % 2 == 0
    );
    const comparators = splitOnComparators
      .filter((_, i) => i % 2)
      .map((c) =>
        c.slice(
          this.regexBuilder.comparatorWrapper.length,
          -this.regexBuilder.comparatorWrapper.length
        )
      );
    const foundComparatorsFns = comparators.map(
      (c) => c as keyof typeof ComparatorConstants.comparatorKeyToFuncs
    ).map(
      (compareKey) => ({
        fn: ComparatorConstants.comparatorKeyToFuncs[compareKey],
        key: compareKey,
      })
    );
    let precompiledResolvedVariableFns: ParseValueToVariable[] =
      variableWithModifiers.map((baseString) =>
        this.parseModifiedVariable(baseString, fullStringModifiers)
      );

    // COMPARATOR logic: compare all ResolvedVariables against each other to make one ResolvedVariable (as precompiled wrapper function (parseValue) => ResolvedVariable)
    let precompiledResolvedVariableFn = (
      parseValue: ParseValue
    ): ResolvedVariable => {
      if (precompiledResolvedVariableFns.length == 1)
        return precompiledResolvedVariableFns[0](parseValue);

      const resolvedVariables = precompiledResolvedVariableFns.map((fn) =>
        fn(parseValue)
      );
      const reducedResolvedVariable = resolvedVariables.reduce(
        (prev, cur, i) => {
          if (prev.error !== undefined) return prev;
          if (cur.error !== undefined) return cur;
          const { fn: comparatorFn, key: compareKey } = foundComparatorsFns[i - 1]!;
            
          try {
            // the comparator key between prev and cur (from splitOnComparators) is at i - 1
            const result = comparatorFn(prev.result, cur.result);
            return { result: result };
          } catch (e) {
            return {
              error: `{unable_to_compare(<${prev.result}>::${compareKey}::<${cur.result}>, ${e})}`,
            };
          }
        }
      );
      return reducedResolvedVariable;
    }; // end of COMPARATOR logic

    // CHECK TRUE/FALSE logic: compile the true/false templates and apply them to the resolved variable
    if (fullStringModifiers.mod_check !== undefined) {
      const _precompiledResolvedVariableFn = precompiledResolvedVariableFn;
      precompiledResolvedVariableFn = (
        parseValue: ParseValue
      ): ResolvedVariable => {
        const resolved = _precompiledResolvedVariableFn(parseValue);
        if (![true, false].includes(resolved.result)) {
          return {
            error: `{cannot_coerce_boolean_for_check_from(${resolved.result})}`,
          };
        }
        return {
          result: resolved.result
            ? fullStringModifiers.mod_check!.true
            : fullStringModifiers.mod_check!.false,
        };
      };
    } // end of CHECK TRUE/FALSE logic

    return precompiledResolvedVariableFn;
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
    fullStringModifiers: FullStringModifiers
  ): ParseValueToVariable {
    // PARSE VARIABLE logic - get variableType and propertyName from baseString without regex
    const find = (keys: string[], key: string) => {
      const keyKeys = keys.filter((k) => key == k.toLowerCase());
      return keyKeys.length ? keyKeys[0] : undefined;
    };
    const variableTypeKeys = Object.keys(this.regexBuilder.hardcodedParseValueKeysForRegexMatching);
    const variableType = find(variableTypeKeys, baseString.split('.')[0].toLowerCase());
    if (!variableType) return () => ({ error: `{unknown_variableType(${variableType})}` }); // should never happen
    baseString = baseString.substring(variableType.length + `.`.length);
    const propertyNameKeys = Object.keys(this.regexBuilder.hardcodedParseValueKeysForRegexMatching[variableType as keyof ParseValue]!);
    const propertyName = find(propertyNameKeys, baseString.split(new RegExp(`[^a-zA-Z]`))[0].toLowerCase());
    if (!propertyName) return () => ({ error: `{unknown_propertyName(${variableType}.${propertyName})}` }); // should never happen
    // end of PARSE VARIABLE logic

    const allModifiers = baseString.substring(propertyName.length);
    let sortedModMatches: string[] = [];
    if (allModifiers.length) {
      const singleModTerminator = `(?=${this.regexBuilder.modifierPrefix}|$)`; // if there's multiple modifiers, or $ for the end of the string
      const singleValidModRe = new RegExp(
        `(${this.regexBuilder.buildModifierRegexPattern()})${singleModTerminator}`,
        'g'
      );

      sortedModMatches = [...allModifiers.matchAll(singleValidModRe)]
        .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
        .map(
          (regExpExecArray) =>
            regExpExecArray[1].slice(
              this.regexBuilder.modifierPrefix.length
            ) /* First capture group, aka the modifier name */
        );
    }

    return (parseValue: ParseValue) => {
      const variableDict = parseValue[variableType as keyof ParseValue]!;
      const property = variableDict[
        propertyName as keyof typeof variableDict
      ] as any;

      // APPLY MULTIPLE MODIFIERS logic
      let result = property;
      for (const lastModMatched of sortedModMatches) {
        result = this.applySingleModifier(
          result,
          lastModMatched,
          fullStringModifiers
        );
        if (result === undefined) {
          // Return error since <result>::modifier => undefined
          switch (typeof property) {
            case 'string': case 'number': case 'boolean':
              return { error: `{unknown_${typeof property}_modifier(${lastModMatched})}` };
            case 'object': return { error: `{unknown_array_modifier(${lastModMatched})}` };
            default: return { error: `{unknown_modifier(${lastModMatched})}` };
          }
        }
      } // end of APPLY MULTIPLE MODIFIERS logic

      return { result: result };
    };
  }

  /**
   * @param variable - the variable to apply the modifier to (e.g. `123`, `"TorBox"`, `["English", "Italian"]`, etc.)
   * @param mod - the modifier to apply
   * @returns `{ result: <resolved modified variable> }` or `{ error: "<errorMessage>" }`
   */
  protected applySingleModifier(
    variable: any,
    mod: string,
    fullStringModifiers: FullStringModifiers
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
          const findStartChar = mod.charAt(`replace(`.length + 1); // either " or '
          const findEndChar = mod.charAt(mod.length - `)`.length - 1); // either " or '

          // Extract the separator from replace(['"]...<matching'">, ['"]...<matching'">)
          const content = _mod.substring(`replace('`.length, _mod.length - `')`.length);

          // split on findStartChar<whitespace?>,<whitespace?>findEndChar
          const [key, replaceKey, shouldBeUndefined] = content.split(
            new RegExp(`${findStartChar}\\s*,\\s*${findEndChar}`)
          );

          if (!shouldBeUndefined && key && replaceKey)
            return variable.replaceAll(key, replaceKey);
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
          const separator = _mod.substring(`join('`.length, _mod.length - `')`.length);
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
  public checkTFSplit = '"||"';
  public modifierPrefix = '::';
  public comparatorWrapper = '::';
  public hardcodedParseValueKeysForRegexMatching: ParseValue;
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

    // enforce non-duplicate section keys (case-insensitive)
    const sectionKeys = new Set<string>();
    Object.keys(
      this.hardcodedParseValueKeysForRegexMatching
    ).forEach((key) => {
      if (sectionKeys.has(key.toLowerCase())) throw new Error(`Must Remove Case-Insensitive Duplicate: '${key}' in ParseValue`);
      sectionKeys.add(key.toLowerCase());
    });

    const validVariableNames = [...sectionKeys].flatMap((sectionKey) => {
      const section =
        this.hardcodedParseValueKeysForRegexMatching[
          sectionKey as keyof ParseValue
        ];
      if (section) {
        const sectionSubKeys = new Set<string>();
        Object.keys(section).forEach((key) => {
          if (sectionSubKeys.has(key.toLowerCase())) throw new Error(`Must Remove Case-Insensitive Duplicate: '${sectionKey}.${key}' in ParseValue`);
          sectionSubKeys.add(key.toLowerCase());
        });
        
        return `${sectionKey}\\.(${[...sectionSubKeys].join('|')})`;
      }
      return []; // @flatMap
    });
    return `(${validVariableNames.join('|')})`;
  }
  /**
   * RegEx Capture Pattern: `::<modifier>`
   *
   * Prefix `::` is optionally part of the modifier regex pattern
   *
   * (no capture group)
   */
  public buildModifierRegexPattern(): string {
    const validModifiers = Object.keys(ModifierConstants.modifiers).map((key) =>
      key.replace(/[\(\)\'\"\$\^\~\=\>\<]/g, '\\$&')
    );
    return `${this.modifierPrefix}(?:${validModifiers.join('|')})`;
  }
  /**
   * RegEx Capture Pattern: `::<comparator>::`
   *
   * (no capture group)
   */
  public buildComparatorRegexPattern(): string {
    const comparatorKeys = Object.keys(
      ComparatorConstants.comparatorKeyToFuncs
    );
    return `${this.comparatorWrapper}(?:${comparatorKeys.join('|')})${this.comparatorWrapper}`;
  }
  /**
   * RegEx Capture Pattern: `::<tzLocale>`
   *
   * (with named capture group `tzLocale`)
   */
  public buildTZLocaleRegexPattern(): string {
    // TZ Locale pattern (hardcoded, can add more later / make dynamic later when needed/implemented)
    return `${this.modifierPrefix}(?<mod_tzlocale>UTC|GMT|EST|PST|en-US|en-GB|Europe/London|America/New_York)`;
  }
  /**
   * RegEx Capture Pattern: `["<check_true>||<check_false>"]`
   *
   * (with named capture group `<mod_check_true>` and `<mod_check_false>` and `mod_check`=`"<check_true>||<check_false>"`)
   */
  public buildCheckRegexPattern(): string {
    // Build the conditional check pattern separately
    // Use [^"]* to capture anything except quotes, making it non-greedy
    const checkTrue = `(?<mod_check_true>.*)`;
    const checkFalse = `(?<mod_check_false>.*)`;
    return `\\[(?<mod_check>"${checkTrue}${this.checkTFSplit}${checkFalse}")\\]`;
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

    return new RegExp(`^${regexPattern}$`, 'i');
  }
}

/**
 * Static Constants
 */
type FullStringModifiers = {
  mod_check?: {
    true: string;
    false: string;
  };
  mod_tzlocale?: string;
};
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
    bytes10: (value: number) => formatBytes(value, 1000),
    bytes2: (value: number) => formatBytes(value, 1024),
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
    'replace(".*?"\\s*?,\\s*?".*?")': null,
    "join('.*?')": null,
    'join(".*?")': null,
    '$.+?': null,
    '^.+?': null,
    '~.+?': null,
    '=.+?': null,
    '>=.+?': null,
    '>.+?': null,
    '<=.+?': null,
    '<.+?': null,
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
