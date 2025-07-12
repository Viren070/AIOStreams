import { ParsedStream } from '../db';
// import { constants, Env, createLogger } from '../utils';
import * as constants from '../utils/constants';
import { createLogger } from '../utils/logger';
import { formatBytes, formatDuration, languageToEmoji } from './utils';
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
    languageEmojis: string[] | null;
    wedontknowwhatakilometeris: string[] | null;
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

export abstract class BaseFormatter {
  protected config: FormatterConfig;
  protected addonName: string;

  constructor(config: FormatterConfig, addonName?: string) {
    this.config = config;
    this.addonName = addonName || Env.ADDON_NAME;
  }

  public format(stream: ParsedStream): { name: string; description: string } {
    const parseValue = this.convertStreamToParseValue(stream);
    return {
      name: this.parseString(this.config.name, parseValue) || '',
      description: this.parseString(this.config.description, parseValue) || '',
    };
  }

  protected convertStreamToParseValue(stream: ParsedStream): ParseValue {
    return {
      config: {
        addonName: this.addonName,
      },
      stream: {
        filename: stream.filename || null,
        folderName: stream.folderName || null,
        size: stream.size || null,
        folderSize: stream.folderSize || null,
        library: stream.library !== undefined ? stream.library : null,
        quality: stream.parsedFile?.quality || null,
        resolution: stream.parsedFile?.resolution || null,
        languages: stream.parsedFile?.languages || null,
        languageEmojis: stream.parsedFile?.languages
          ? stream.parsedFile.languages
              .map((lang) => languageToEmoji(lang) || lang)
              .filter((value, index, self) => self.indexOf(value) === index)
          : null,
        wedontknowwhatakilometeris: stream.parsedFile?.languages
          ? stream.parsedFile.languages
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
        presetId: stream.addon.presetType,
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

  protected parseString(str: string, value: ParseValue): string | null {
    if (!str) return null;

    const replacer = (key: string, value: unknown) => {
      return value;
    };

    const data = {
      stream: value.stream,
      service: value.service,
      addon: value.addon,
      config: value.config,
    };

    value.debug = {
      json: JSON.stringify(data, replacer),
      jsonf: JSON.stringify(data, replacer, 2),
    };

    const re =
      /\{(?<type>stream|service|addon|config|debug)\.(?<prop>\w+)(::(?<mod>(\w+(\([^)]*\))?|<|<=|=|>=|>|\^|\$|~|\/)+))?((::(?<mod_tzlocale>\S+?))|(?<mod_check>\[(?<mod_check_true>".*?")\|\|(?<mod_check_false>".*?")\]))?\}/gi;
    let matches: RegExpExecArray | null;

    while ((matches = re.exec(str))) {
      if (!matches.groups) continue;

      const index = matches.index as number;

      const getV = value[matches.groups.type as keyof ParseValue];

      if (!getV) {
        str = this.replaceCharsFromString(
          str,
          '{unknown_type}',
          index,
          re.lastIndex
        );
        re.lastIndex = index;
        continue;
      }

      const v =
        getV[
          matches.groups.prop as
            | keyof ParseValue['stream']
            | keyof ParseValue['service']
            | keyof ParseValue['addon']
        ];

      if (v === undefined) {
        str = this.replaceCharsFromString(
          str,
          '{unknown_value}',
          index,
          re.lastIndex
        );
        re.lastIndex = index;
        continue;
      }

      if (matches.groups.mod) {
        str = this.replaceCharsFromString(
          str,
          this.modifier(
            matches.groups.mod,
            v,
            matches.groups.mod_tzlocale ?? undefined,
            matches.groups.mod_check_true ?? undefined,
            matches.groups.mod_check_false ?? undefined,
            value
          ),
          index,
          re.lastIndex
        );
        re.lastIndex = index;
        continue;
      }

      str = this.replaceCharsFromString(str, v, index, re.lastIndex);
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
    mod = mod.toLowerCase();
    check_true = check_true?.slice(1, -1);
    check_false = check_false?.slice(1, -1);

    if (Array.isArray(value)) {
      switch (true) {
        case mod === 'join':
          return value.join(', ');
        case mod.startsWith('join(') && mod.endsWith(')'): {
          // Extract the separator from join(separator)
          // e.g. join(' - ')
          const separator = mod
            .substring(5, mod.length - 1)
            .replace(/^['"]|['"]$/g, '');
          return value.join(separator);
        }
        case mod == 'length':
          return value.length.toString();
        case mod == 'first':
          return value.length > 0 ? String(value[0]) : '';
        case mod == 'last':
          return value.length > 0 ? String(value[value.length - 1]) : '';
        case mod == 'random':
          return value.length > 0
            ? String(value[Math.floor(Math.random() * value.length)])
            : '';
        case mod == 'sort':
          return [...value].sort().join(', ');
        case mod == 'reverse':
          return [...value].reverse().join(', ');
        case mod.startsWith('~'): {
          if (typeof check_true !== 'string' || typeof check_false !== 'string')
            return `{unknown_array_modifier(${mod})}`;

          const check = mod.replace('~', '').replace('_', ' ');

          if (_value) {
            return value.some((item) => item.toLowerCase().includes(check))
              ? this.parseString(check_true, _value) || check_true
              : this.parseString(check_false, _value) || check_false;
          }

          return value.some((item) => item.toLowerCase().includes(check))
            ? check_true
            : check_false;
        }
        case mod == 'exists': {
          if (typeof check_true !== 'string' || typeof check_false !== 'string')
            return `{unknown_array_modifier(${mod})}`;

          if (_value) {
            return value.length > 0
              ? this.parseString(check_true, _value) || check_true
              : this.parseString(check_false, _value) || check_false;
          }

          return value.length > 0 ? check_true : check_false;
        }
        default:
          return `{unknown_array_modifier(${mod})}`;
      }
    } else if (typeof value === 'string') {
      switch (true) {
        case mod == 'upper':
          return value.toUpperCase();
        case mod == 'lower':
          return value.toLowerCase();
        case mod == 'title': {
          return value
            .split(' ')
            .map((word) => word.toLowerCase())
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
        }
        case mod == 'length':
          return value.length.toString();
        case mod == 'reverse':
          return value.split('').reverse().join('');
        case mod == 'base64':
          return btoa(value);
        case mod == 'string':
          return value;
        case mod == 'exists': {
          if (typeof check_true !== 'string' || typeof check_false !== 'string')
            return `{unknown_str_modifier(${mod})}`;

          if (_value) {
            return value != 'null' && value
              ? this.parseString(check_true, _value) || check_true
              : this.parseString(check_false, _value) || check_false;
          }

          return value != 'null' && value ? check_true : check_false;
        }
        case mod.startsWith('='): {
          if (typeof check_true !== 'string' || typeof check_false !== 'string')
            return `{unknown_str_modifier(${mod})}`;

          const check = mod.replace('=', '');

          if (!check) return `{unknown_str_modifier(${mod})}`;

          if (_value) {
            return value.toLowerCase() == check
              ? this.parseString(check_true, _value) || check_true
              : this.parseString(check_false, _value) || check_false;
          }

          return value.toLowerCase() == check ? check_true : check_false;
        }
        case mod.startsWith('$'): {
          if (typeof check_true !== 'string' || typeof check_false !== 'string')
            return `{unknown_str_modifier(${mod})}`;

          const check = mod.replace('$', '');

          if (!check) return `{unknown_str_modifier(${mod})}`;

          if (_value) {
            return value.toLowerCase().startsWith(check)
              ? this.parseString(check_true, _value) || check_true
              : this.parseString(check_false, _value) || check_false;
          }

          return value.toLowerCase().startsWith(check)
            ? check_true
            : check_false;
        }
        case mod.startsWith('^'): {
          if (typeof check_true !== 'string' || typeof check_false !== 'string')
            return `{unknown_str_modifier(${mod})}`;

          const check = mod.replace('^', '');

          if (!check) return `{unknown_str_modifier(${mod})}`;

          if (_value) {
            return value.toLowerCase().endsWith(check)
              ? this.parseString(check_true, _value) || check_true
              : this.parseString(check_false, _value) || check_false;
          }

          return value.toLowerCase().endsWith(check) ? check_true : check_false;
        }
        case mod.startsWith('~'): {
          if (typeof check_true !== 'string' || typeof check_false !== 'string')
            return `{unknown_str_modifier(${mod})}`;

          const check = mod.replace('~', '');

          if (!check) return `{unknown_str_modifier(${mod})}`;

          if (_value) {
            return value.toLowerCase().includes(check)
              ? this.parseString(check_true, _value) || check_true
              : this.parseString(check_false, _value) || check_false;
          }

          return value.toLowerCase().includes(check) ? check_true : check_false;
        }
        default:
          return `{unknown_str_modifier(${mod})}`;
      }
    } else if (typeof value === 'number') {
      switch (true) {
        case mod == 'comma':
          return value.toLocaleString();
        case mod == 'hex':
          return value.toString(16);
        case mod == 'octal':
          return value.toString(8);
        case mod == 'binary':
          return value.toString(2);
        case mod == 'bytes10' || mod == 'bytes':
          return formatBytes(value, 1000);
        case mod == 'bytes2':
          return formatBytes(value, 1024);
        case mod == 'string':
          return value.toString();
        case mod == 'time':
          return formatDuration(value);
        case mod.startsWith('>='): {
          if (typeof check_true !== 'string' || typeof check_false !== 'string')
            return `{unknown_int_modifier(${mod})}`;

          const check = Number(mod.replace('>=', ''));

          if (Number.isNaN(check)) return `{unknown_int_modifier(${mod})}`;

          if (_value) {
            return value >= check
              ? this.parseString(check_true, _value) || check_true
              : this.parseString(check_false, _value) || check_false;
          }

          return value >= check ? check_true : check_false;
        }
        case mod.startsWith('>'): {
          if (typeof check_true !== 'string' || typeof check_false !== 'string')
            return `{unknown_int_modifier(${mod})}`;

          const check = Number(mod.replace('>', ''));

          if (Number.isNaN(check)) return `{unknown_int_modifier(${mod})}`;

          if (_value) {
            return value > check
              ? this.parseString(check_true, _value) || check_true
              : this.parseString(check_false, _value) || check_false;
          }

          return value > check ? check_true : check_false;
        }
        case mod.startsWith('='): {
          if (typeof check_true !== 'string' || typeof check_false !== 'string')
            return `{unknown_int_modifier(${mod})}`;

          const check = Number(mod.replace('=', ''));

          if (Number.isNaN(check)) return `{unknown_int_modifier(${mod})}`;

          if (_value) {
            return value == check
              ? this.parseString(check_true, _value) || check_true
              : this.parseString(check_false, _value) || check_false;
          }

          return value == check ? check_true : check_false;
        }
        case mod.startsWith('<='): {
          if (typeof check_true !== 'string' || typeof check_false !== 'string')
            return `{unknown_int_modifier(${mod})}`;

          const check = Number(mod.replace('<=', ''));

          if (Number.isNaN(check)) return `{unknown_int_modifier(${mod})}`;

          if (_value) {
            return value <= check
              ? this.parseString(check_true, _value) || check_true
              : this.parseString(check_false, _value) || check_false;
          }

          return value <= check ? check_true : check_false;
        }
        case mod.startsWith('<'): {
          if (typeof check_true !== 'string' || typeof check_false !== 'string')
            return `{unknown_int_modifier(${mod})}`;

          const check = Number(mod.replace('<', ''));

          if (Number.isNaN(check)) return `{unknown_int_modifier(${mod})}`;

          if (_value) {
            return value < check
              ? this.parseString(check_true, _value) || check_true
              : this.parseString(check_false, _value) || check_false;
          }

          return value < check ? check_true : check_false;
        }
        default:
          return `{unknown_int_modifier(${mod})}`;
      }
    } else if (typeof value === 'boolean') {
      switch (true) {
        case mod == 'istrue': {
          if (typeof check_true !== 'string' || typeof check_false !== 'string')
            return `{unknown_bool_modifier(${mod})}`;

          if (_value) {
            return value
              ? this.parseString(check_true, _value) || check_true
              : this.parseString(check_false, _value) || check_false;
          }

          return value ? check_true : check_false;
        }
        case mod == 'isfalse': {
          if (typeof check_true !== 'string' || typeof check_false !== 'string')
            return `{unknown_bool_modifier(${mod})}`;

          if (_value) {
            return !value
              ? this.parseString(check_true, _value) || check_true
              : this.parseString(check_false, _value) || check_false;
          }

          return !value ? check_true : check_false;
        }
        default:
          return `{unknown_bool_modifier(${mod})}`;
      }
    }

    if (
      typeof check_false == 'string' &&
      (['>', '>=', '=', '<=', '<', '~', '$', '^'].some((modif) =>
        mod.startsWith(modif)
      ) ||
        ['istrue', 'exists', 'isfalse'].includes(mod))
    ) {
      if (_value) return this.parseString(check_false, _value) || check_false;
      return check_false;
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
