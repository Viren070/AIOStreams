import {
  formatBytes,
  formatSmartBytes,
  formatBitrate,
  formatSmartBitrate,
  formatDuration,
  formatDurationPattern,
  formatDatePattern,
  makeSmall,
  normaliseDuration,
} from '../utils.js';
import {
  languageToCode,
  languageToEmoji,
  normaliseLanguage,
} from '../../utils/languages.js';
import { compileObjectFilter } from '../../utils/object-filter.js';
import { sanitise, substituteTools } from './sentinels.js';

/**
 * Modifier implementations, and the binding of a modifier's source text to a
 * callable.
 *
 * Arguments are parsed once, at compile time. Type dispatch stays per render
 * because a chain like `stream.size::string::reverse` changes the value's type
 * partway through.
 */

// ---------------------------------------------------------------- plain tables

const toLanguageCode = (value: string): string => {
  const name = normaliseLanguage(value) ?? value;
  return languageToCode(name) || name.toUpperCase();
};

const toLanguageEmoji = (value: string): string => {
  const name = normaliseLanguage(value) ?? value;
  return languageToEmoji(name) ?? '';
};

// Per element, dropping blanks and de-duplicating
const mapLanguages = (
  value: string[],
  convert: (item: string) => string
): string[] => [
  ...new Set(value.map((item) => convert(String(item))).filter(Boolean)),
];

const stringModifiers = {
  upper: (value: string) => value.toUpperCase(),
  lower: (value: string) => value.toLowerCase(),
  trim: (value: string) => value.trim(),
  title: (value: string) =>
    value
      .split(' ')
      .map((word) => word.toLowerCase())
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' '),
  length: (value: string) => value.length.toString(),
  reverse: (value: string) => value.split('').reverse().join(''),
  base64: (value: string) => Buffer.from(value, 'utf8').toString('base64'),
  string: (value: string) => value,
  smallcaps: (value: string) => makeSmall(value),
  subscript: (value: string) => mapChars(value, DIGITS, SUBSCRIPT_DIGITS),
  superscript: (value: string) => mapChars(value, DIGITS, SUPERSCRIPT_DIGITS),
  languagecode: toLanguageCode,
  languageemoji: toLanguageEmoji,
};

const DIGITS = '0123456789+-=()';
const SUBSCRIPT_DIGITS = '₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎';
const SUPERSCRIPT_DIGITS = '⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾';

/**
 * Maps characters by position. Anything in `from` without a counterpart in `to`
 * is left alone rather than dropped, so a short `to` cannot silently lose text.
 */
function mapChars(value: string, from: string, to: string): string {
  const table = new Map<string, string>();
  const source = [...from];
  const target = [...to];
  for (let i = 0; i < source.length && i < target.length; i++) {
    table.set(source[i], target[i]);
  }
  return [...value].map((char) => table.get(char) ?? char).join('');
}

export function isObjectList(value: unknown): value is object[] {
  return (
    Array.isArray(value) && typeof value[0] === 'object' && value[0] !== null
  );
}

const OBJECT_LIST_MODIFIERS = new Set(['length', 'reverse']);

const arrayGetOrDefault = (value: string[], index: number) =>
  value.length > 0 ? String(value[index]) : '';

const sortBy = (ascending: boolean) => (value: (string | number)[]) =>
  [...value].sort((a, b) => {
    const result =
      typeof a === 'number' && typeof b === 'number'
        ? a - b
        : String(a).localeCompare(String(b), undefined, { numeric: true });
    return ascending ? result : -result;
  });

const stars = (padWithEmpty: boolean) => (value: number) => {
  const FULL = '★';
  const HALF = '⯪';
  const EMPTY = '☆';
  const full = Math.floor(value / 20);
  const half = value % 20 >= 10 ? 1 : 0;
  return (
    FULL.repeat(full) +
    HALF.repeat(half) +
    (padWithEmpty ? EMPTY.repeat(5 - full - half) : '')
  );
};

const arrayModifiers = {
  join: (value: string[]) => value.join(', '),
  length: (value: string[]) => value.length.toString(),
  first: (value: string[]) => arrayGetOrDefault(value, 0),
  last: (value: string[]) => arrayGetOrDefault(value, value.length - 1),
  random: (value: string[]) =>
    arrayGetOrDefault(value, Math.floor(Math.random() * value.length)),
  sort: sortBy(true),
  rsort: sortBy(false),
  lsort: (value: any[]) => [...value].sort(),
  reverse: (value: string[]) => [...value].reverse(),
  languagecode: (value: string[]) => mapLanguages(value, toLanguageCode),
  languageemoji: (value: string[]) => mapLanguages(value, toLanguageEmoji),
  string: (value: string[]) => value.toString(),
};

const numberModifiers = {
  comma: (value: number) => value.toLocaleString(),
  hex: (value: number) => value.toString(16),
  octal: (value: number) => value.toString(8),
  binary: (value: number) => value.toString(2),
  bytes: (value: number) => formatBytes(value, 1000),
  sbytes: (value: number) => formatSmartBytes(value, 1000),
  sbytes10: (value: number) => formatSmartBytes(value, 1000),
  sbytes2: (value: number) => formatSmartBytes(value, 1024),
  rbytes: (value: number) => formatBytes(value, 1000, true),
  bytes10: (value: number) => formatBytes(value, 1000),
  rbytes10: (value: number) => formatBytes(value, 1000, true),
  bytes2: (value: number) => formatBytes(value, 1024),
  rbytes2: (value: number) => formatBytes(value, 1024, true),
  bitrate: (value: number) => formatBitrate(value),
  rbitrate: (value: number) => formatBitrate(value, true),
  sbitrate: (value: number) => formatSmartBitrate(value),
  string: (value: number) => value.toString(),
  time: (value: number) => formatDuration(normaliseDuration(value)),
  star: stars(false),
  pstar: stars(true),
};

const booleanModifiers = {
  string: (value: boolean) => String(value),
};

const conditionalModifiers = {
  exact: {
    istrue: (value: any) => value === true,
    isfalse: (value: any) => value === false,
    exists: (value: any) => {
      if (value === undefined || value === null) return false;
      if (typeof value === 'string') return /\S/.test(value);
      if (Array.isArray(value)) return value.length > 0;
      return true;
    },
  },

  prefix: {
    $: (value: string | string[], check: string) =>
      typeof value === 'string'
        ? value.startsWith(check)
        : value?.[0] === check,
    '^': (value: string | string[], check: string) =>
      typeof value === 'string'
        ? value.endsWith(check)
        : value?.[value.length - 1] === check,
    '~': (value: string | string[], check: string) => value.includes(check),
    '=': (value: string, check: string) => value === check,
    '>=': (value: string | number, check: string | number) => value >= check,
    '>': (value: string | number, check: string | number) => value > check,
    '<=': (value: string | number, check: string | number) => value <= check,
    '<': (value: string | number, check: string | number) => value < check,
  },
};

/** Plain modifier names grouped by the value type they apply to. */
export const stringModifierNames: readonly string[] =
  Object.keys(stringModifiers);
export const numberModifierNames: readonly string[] =
  Object.keys(numberModifiers);
export const arrayModifierNames: readonly string[] =
  Object.keys(arrayModifiers);
export const booleanModifierNames: readonly string[] =
  Object.keys(booleanModifiers);
/** Argument-free conditionals (`istrue`, `isfalse`, `exists`); apply to any type. */
export const conditionalModifierNames: readonly string[] = Object.keys(
  conditionalModifiers.exact
);

export const allModifierNames: readonly string[] = [
  ...stringModifierNames,
  ...booleanModifierNames,
  ...numberModifierNames,
  ...arrayModifierNames,
  ...conditionalModifierNames,
];

export const prefixOperators = Object.keys(conditionalModifiers.prefix).sort(
  (a, b) => b.length - a.length
);

// ------------------------------------------------------------ argument parsing

/** Pulls quoted arguments out of a call's argument list, in order. */
export function quotedArguments(inner: string): string[] {
  const args: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(inner)) !== null) {
    args.push(match[1] ?? match[2] ?? '');
  }
  return args;
}

/**
 * Pulls `{section.property}` references out of a call's argument list. A
 * reference inside a quoted argument is literal text, so it is skipped.
 */
export function referenceArguments(inner: string): string[] {
  const withoutQuoted = inner.replace(/"[^"]*"|'[^']*'/g, '');
  const pattern = /\{\s*([A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*)\s*\}/g;
  const found = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(withoutQuoted)) !== null) {
    found.add(match[1]);
  }
  return [...found];
}

/**
 * The literal arguments plus everything the references resolve to. References
 * resolve per render; `literals` is expected to already be in the right case.
 */
function resolveListArgument(
  literals: readonly string[],
  references: readonly string[],
  parseValue: unknown,
  ctx: ModifierContext,
  lower = true
): string[] {
  if (!references.length) return literals as string[];
  const out = [...literals];
  for (const reference of references) {
    for (const value of ctx.resolveValues(reference, parseValue) ?? []) {
      out.push(lower ? value.toLowerCase() : value);
    }
  }
  return out;
}

/** `"'%H:%M'"` -> `"%H:%M"`; undefined when not quoted. */
function unquote(arg: string): string | undefined {
  const quote = arg[0];
  return arg.length >= 2 &&
    (quote === "'" || quote === '"') &&
    arg.endsWith(quote)
    ? arg.slice(1, -1)
    : undefined;
}

// ------------------------------------------------------------------- compiling

export interface ModifierContext {
  /** Injected so this module needs no knowledge of ParseValue. */
  resolveVariable(source: string, parseValue: unknown): string | undefined;
  /** A field's value as a list, for modifiers that compare against one. */
  resolveValues(source: string, parseValue: unknown): string[] | undefined;
}

/**
 * The longest string a render keeps
 */
export const MAX_RENDER_LENGTH = 8000;

/**
 * `replaceAll` which adheres to `MAX_RENDER_LENGTH`.
 */
function replaceAll(
  value: string,
  search: string,
  replacement: string
): string {
  if (!search) return value;

  const growth = replacement.length - search.length;
  const worstCase =
    growth <= 0
      ? value.length
      : value.length + Math.floor(value.length / search.length) * growth;
  if (worstCase <= MAX_RENDER_LENGTH) {
    return value.replaceAll(search, replacement);
  }

  let out = '';
  let from = 0;
  while (out.length < MAX_RENDER_LENGTH) {
    const at = value.indexOf(search, from);
    if (at === -1) {
      out += value.slice(from);
      break;
    }
    out += value.slice(from, at) + replacement;
    from = at + search.length;
  }
  return out.length > MAX_RENDER_LENGTH ? out.slice(0, MAX_RENDER_LENGTH) : out;
}

/**
 * Returns `undefined` when the modifier does not apply to the value's runtime
 * type; the caller turns that into the right error message.
 */
export type CompiledModifier = (
  value: unknown,
  parseValue: unknown,
  ctx: ModifierContext
) => unknown;

function compileConditional(lower: string): CompiledModifier | undefined {
  const exact = conditionalModifiers.exact;
  const isExact = Object.prototype.hasOwnProperty.call(exact, lower);
  const operator = prefixOperators.find((op) => lower.startsWith(op));
  if (!isExact && !operator) return undefined;

  const rawCheck = operator ? lower.slice(operator.length) : '';
  const isArrayCapable = operator ? ['$', '^', '~'].includes(operator) : false;
  const isNumericCapable = operator
    ? ['<', '<=', '>', '>=', '='].includes(operator)
    : false;

  return (value) => {
    try {
      // absent values are false without consulting the operator
      if (!exact.exists(value)) return false;
      if (isExact) return exact[lower as keyof typeof exact](value);
      if (isObjectList(value)) return undefined;

      const arrayValue =
        Array.isArray(value) && value.every((item) => typeof item === 'string')
          ? value.map((item) => item.toLowerCase())
          : undefined;
      const stringValue = String(value).toLowerCase();

      // whitespace is only stripped from the check when the value has none
      const check = /\s/.test(stringValue)
        ? rawCheck
        : rawCheck.replace(/\s/g, '');

      const numericValue = Number(stringValue.replace(/,\s/g, ''));
      const numericCheck = Number(check.replace(/,\s/g, ''));
      const numeric =
        isNumericCapable && !isNaN(numericValue) && !isNaN(numericCheck);

      const compare = conditionalModifiers.prefix[
        operator as keyof typeof conditionalModifiers.prefix
      ] as (a: any, b: any) => boolean;

      return compare(
        numeric
          ? numericValue
          : ((isArrayCapable ? arrayValue : undefined) ?? stringValue),
        numeric ? numericCheck : check
      );
    } catch {
      return false;
    }
  };
}

function compileParameterised(
  source: string,
  lower: string
): CompiledModifier | undefined {
  const open = source.indexOf('(');
  if (open === -1 || !source.endsWith(')')) return undefined;
  const name = lower.slice(0, open);
  const inner = source.slice(open + 1, -1);

  switch (name) {
    case 'replace': {
      // Split on the separator between the two arguments rather than pairing
      // quotes, so a quote inside an argument stays literal.
      const variableForm = /^\s*\{([^}]+)\}\s*,\s*(['"])([\s\S]*)\2\s*$/.exec(
        inner
      );
      if (variableForm) {
        const [, variablePath, , rawReplacement] = variableForm;
        const replacementText = substituteTools(rawReplacement);
        return (value, parseValue, ctx) => {
          if (typeof value !== 'string') return undefined;
          const resolved = ctx.resolveVariable(variablePath, parseValue);
          return resolved
            ? replaceAll(value, resolved, replacementText)
            : value;
        };
      }

      const openQuote = source.charAt('replace('.length);
      const closeQuote = source.charAt(source.length - 2);
      const body = source.slice('replace('.length + 1, -2);
      const [rawSearch, replacement, extra] = body.split(
        new RegExp(`${openQuote}\\s*,\\s*${closeQuote}`)
      );

      // an empty search would match between every character
      if (extra !== undefined || !rawSearch || replacement === undefined) {
        return (value) => (typeof value === 'string' ? value : undefined);
      }

      const variableKey =
        rawSearch.startsWith('{') && rawSearch.endsWith('}')
          ? rawSearch.slice(1, -1)
          : undefined;

      const replacementText = substituteTools(replacement);

      return (value, parseValue, ctx) => {
        if (typeof value !== 'string') return undefined;
        if (!variableKey) return replaceAll(value, rawSearch, replacementText);

        const resolved = ctx.resolveVariable(variableKey, parseValue);
        if (!resolved) return value;
        return replaceAll(value, resolved, replacementText);
      };
    }

    case 'remove':
    case 'keep': {
      const args = quotedArguments(inner);
      const references = referenceArguments(inner);
      if (args.length === 0 && references.length === 0) return () => undefined;
      const targets = args.filter(Boolean);
      const loweredSet = new Set(targets.map((t) => t.toLowerCase()));
      const lowered = [...loweredSet];
      const keeping = name === 'keep';
      return (value, parseValue, ctx) => {
        if (typeof value === 'string') {
          // keeping part of a single string has no meaning
          if (keeping) return undefined;
          let result = value;
          // removing from a string is a substring match, so case is kept
          const removals = resolveListArgument(
            targets,
            references,
            parseValue,
            ctx,
            false
          );
          for (const target of removals) result = result.replaceAll(target, '');
          return result;
        }
        if (Array.isArray(value) && !isObjectList(value)) {
          const set = references.length
            ? new Set(resolveListArgument(lowered, references, parseValue, ctx))
            : loweredSet;
          return value.filter(
            (item) => set.has(String(item).toLowerCase()) === keeping
          );
        }
        return undefined;
      };
    }

    case 'join': {
      const raw = unquote(inner);
      if (raw === undefined) return undefined;
      const separator = substituteTools(raw);
      return (value) =>
        Array.isArray(value) && !isObjectList(value)
          ? value.join(separator)
          : undefined;
    }

    case 'where': {
      let filter: ReturnType<typeof compileObjectFilter>;
      try {
        filter = compileObjectFilter(quotedArguments(inner));
      } catch {
        return () => undefined;
      }
      return (value, parseValue, ctx) =>
        Array.isArray(value) && (!value.length || isObjectList(value))
          ? value.filter((item) =>
              filter(item, (path) => ctx.resolveValues(path, parseValue))
            )
          : undefined;
    }

    case 'pluck': {
      const key = unquote(inner);
      if (key === undefined) return undefined;
      return (value) => {
        if (!Array.isArray(value)) return undefined;
        if (value.length && !isObjectList(value)) return undefined;
        const found = new Set<string>();
        for (const item of value as Record<string, unknown>[]) {
          const field = item[key];
          if (typeof field === 'string' && field) found.add(sanitise(field));
        }
        return [...found];
      };
    }

    case 'truncate': {
      const limit = parseInt(inner, 10);
      if (isNaN(limit) || limit < 0) return undefined;
      const segmenter = new Intl.Segmenter();
      return (value) => {
        if (typeof value !== 'string') return undefined;
        const graphemes = [...segmenter.segment(value)];
        if (graphemes.length <= limit) return value;
        return (
          graphemes
            .slice(0, limit)
            .map((s) => s.segment)
            .join('')
            .replace(/\s+$/, '') + '…'
        );
      };
    }

    case 'slice': {
      const parts = inner.split(',').map((part) => parseInt(part.trim(), 10));
      if (isNaN(parts[0])) return undefined;
      const [start, end] = [
        parts[0],
        parts.length > 1 && !isNaN(parts[1]) ? parts[1] : undefined,
      ];
      return (value) =>
        Array.isArray(value) ? value.slice(start, end) : undefined;
    }

    case 'default': {
      const fallback = unquote(inner);
      if (fallback === undefined) return undefined;
      return (value) =>
        conditionalModifiers.exact.exists(value) ? value : fallback;
    }

    case 'trim': {
      const chars = unquote(inner);
      if (chars === undefined) return undefined;
      const strip = new Set(chars);
      return (value) => {
        if (typeof value !== 'string') return undefined;
        const points = [...value];
        let start = 0;
        let end = points.length;
        while (start < end && strip.has(points[start])) start += 1;
        while (end > start && strip.has(points[end - 1])) end -= 1;
        return points.slice(start, end).join('');
      };
    }

    case 'translate': {
      const [from, to] = quotedArguments(inner);
      if (from === undefined || to === undefined) return undefined;
      return (value) =>
        typeof value === 'string' ? mapChars(value, from, to) : undefined;
    }

    case 'in': {
      const options = quotedArguments(inner).map((option) =>
        option.toLowerCase()
      );
      const references = referenceArguments(inner);
      if (options.length === 0 && references.length === 0) return undefined;
      const literalSet = new Set(options);
      return (value, parseValue, ctx) => {
        if (value === null || value === undefined) return false;
        if (isObjectList(value)) return undefined;
        const set = references.length
          ? new Set(resolveListArgument(options, references, parseValue, ctx))
          : literalSet;
        if (Array.isArray(value)) {
          return value.some(
            (item) => typeof item === 'string' && set.has(item.toLowerCase())
          );
        }
        return set.has(String(value).toLowerCase());
      };
    }

    case 'time': {
      const pattern = unquote(inner);
      if (pattern === undefined) return undefined;
      return (value) =>
        typeof value === 'number'
          ? formatDurationPattern(normaliseDuration(value), pattern)
          : undefined;
    }

    case 'date': {
      const pattern = unquote(inner);
      if (pattern === undefined) return undefined;
      return (value) =>
        typeof value === 'string'
          ? formatDatePattern(value, pattern)
          : undefined;
    }

    default:
      return undefined;
  }
}

function compilePlain(lower: string): CompiledModifier {
  return (value) => {
    if (typeof value === 'string') {
      const fn = stringModifiers[lower as keyof typeof stringModifiers];
      return fn ? fn(value) : undefined;
    }
    if (Array.isArray(value)) {
      if (isObjectList(value) && !OBJECT_LIST_MODIFIERS.has(lower)) {
        return undefined;
      }
      const fn = arrayModifiers[lower as keyof typeof arrayModifiers];
      return fn ? (fn as (v: any) => unknown)(value) : undefined;
    }
    if (typeof value === 'number') {
      const fn = numberModifiers[lower as keyof typeof numberModifiers];
      return fn ? fn(value) : undefined;
    }
    if (typeof value === 'boolean') {
      const fn = booleanModifiers[lower as keyof typeof booleanModifiers];
      return fn ? fn(value) : undefined;
    }
    return undefined;
  };
}

/**
 * Order matters: conditionals are tested first because `::exists` and `::>5`
 * apply to every type.
 */
export function compileModifier(source: string): CompiledModifier {
  const lower = source.toLowerCase();
  return (
    compileConditional(lower) ??
    compileParameterised(source, lower) ??
    compilePlain(lower)
  );
}
