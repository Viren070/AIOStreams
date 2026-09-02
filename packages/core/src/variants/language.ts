/**
 * Config Expression Language (CEL), the patch language behind config variants.
 *
 * Keep this module free of runtime dependencies beyond `FIELD_META` (whose own
 * imports are type only): the configuration UI imports it directly to lint and
 * preview scripts in the browser.
 */
import { FIELD_META } from '../utils/fieldMeta.js';
import type { UserData } from '../db/schemas.js';

export type CelLiteral =
  | string
  | number
  | boolean
  | null
  | CelLiteral[]
  | { [key: string]: CelLiteral };

export type CelFilterOperator = '=' | '!=' | '*=' | '!*=';

export type CelPathSegment =
  | { kind: 'key'; name: string }
  | { kind: 'index'; index: number }
  | { kind: 'all' }
  | {
      kind: 'filter';
      /** Empty for a primitive list, where the element itself is compared. */
      key: string;
      operator: CelFilterOperator;
      value: CelLiteral;
    };

export interface CelPath {
  root: string;
  segments: CelPathSegment[];
  /** Source text of the path, used to anchor diagnostics. */
  raw: string;
  index: number;
}

export type CelStatement = {
  /** Offset of the statement keyword, for diagnostics. */
  index: number;
  line: number;
} & (
  | { op: 'set' | 'merge'; path: CelPath; value: CelLiteral }
  | { op: 'unset' | 'clear' | 'enable' | 'disable'; path: CelPath }
  | { op: 'add' | 'prepend' | 'remove'; path: CelPath; values: CelLiteral[] }
  | { op: 'useFormatter'; name: string }
  | { op: 'useVariant'; id: string }
);

export interface CelProgram {
  statements: CelStatement[];
  /** Ids referenced by `use variant`, in source order. */
  referencedVariants: string[];
}

export type CelDiagnosticCategory =
  | 'syntax'
  | 'unknown-verb'
  | 'unknown-field'
  | 'denied-field'
  | 'limit'
  | 'no-match'
  | 'unknown-formatter'
  | 'unknown-variant';

export interface CelDiagnostic {
  /** Document offset the diagnostic anchors to. */
  index: number;
  /** The offending source span. */
  source: string;
  line: number;
  message: string;
  category: CelDiagnosticCategory;
  severity: 'error' | 'warning';
  /** Near-miss replacement for `source`, surfaced as an editor quick fix. */
  suggestion?: string;
}

export interface CelLimits {
  maxScriptLength: number;
  maxInstructions: number;
  maxValueDepth: number;
  maxPathSegments: number;
  maxPathMatches: number;
}

export const DEFAULT_CEL_LIMITS: CelLimits = {
  maxScriptLength: 4000,
  maxInstructions: 100,
  maxValueDepth: 10,
  maxPathSegments: 12,
  maxPathMatches: 200,
};

/**
 * Roots present in `FIELD_META` that must never be writable. `variants` in
 * particular, or one variant could rewrite another mid-composition.
 */
export const DENIED_ROOT_KEYS: ReadonlySet<string> = new Set([
  'accessKey',
  'parentConfig',
  'variants',
]);

const FORBIDDEN_KEYS: ReadonlySet<string> = new Set([
  '__proto__',
  'prototype',
  'constructor',
]);

const LITERAL_KEYWORDS: ReadonlySet<string> = new Set([
  'true',
  'false',
  'null',
]);

const VERBS: ReadonlySet<string> = new Set([
  'set',
  'merge',
  'unset',
  'clear',
  'add',
  'prepend',
  'remove',
  'enable',
  'disable',
  'use',
]);

export const VARIANT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;

/**
 * `FIELD_META` is typed as a total record over `keyof UserData`, so a newly
 * added config field is not targetable until classified there.
 */
export function targetableRoots(): string[] {
  return Object.keys(FIELD_META).filter((key) => !DENIED_ROOT_KEYS.has(key));
}

function editDistance(a: string, b: string): number {
  const prev = new Array<number>(b.length + 1);
  const next = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    next[0] = i;
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(
        prev[j] + 1,
        next[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    for (let j = 0; j <= b.length; j++) prev[j] = next[j];
  }
  return prev[b.length];
}

function nearestMatch(word: string, candidates: string[]): string | undefined {
  const lower = word.toLowerCase();
  let best: string | undefined;
  let bestScore = Math.max(2, Math.ceil(word.length / 3));
  for (const candidate of candidates) {
    const score = editDistance(lower, candidate.toLowerCase());
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

interface FailOptions {
  index?: number;
  source?: string;
  category?: CelDiagnosticCategory;
  suggestion?: string;
}

class CelSyntaxError extends Error {
  constructor(
    message: string,
    readonly diagnostic: Omit<CelDiagnostic, 'severity'>
  ) {
    super(message);
  }
}

class Scanner {
  pos = 0;
  line = 1;

  constructor(readonly src: string) {}

  get eof(): boolean {
    return this.pos >= this.src.length;
  }

  peek(offset = 0): string {
    return this.src[this.pos + offset] ?? '';
  }

  advance(count = 1): string {
    let out = '';
    for (let i = 0; i < count && !this.eof; i++) {
      const ch = this.src[this.pos++];
      if (ch === '\n') this.line++;
      out += ch;
    }
    return out;
  }

  /**
   * Newlines are ordinary whitespace: statements are delimited by the fact
   * that a verb can never begin a value, which gives multi-line literals for
   * free.
   */
  skipTrivia(): void {
    while (!this.eof) {
      const ch = this.peek();
      if (ch === '#') {
        while (!this.eof && this.peek() !== '\n') this.advance();
      } else if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
        this.advance();
      } else {
        return;
      }
    }
  }

  /** Recovery point after a bad statement, so one typo does not hide the rest. */
  skipToNextLine(): void {
    while (!this.eof && this.peek() !== '\n') this.advance();
    if (!this.eof) this.advance();
  }

  fail(message: string, options: FailOptions = {}): never {
    const index = options.index ?? this.pos;
    const source =
      options.source ?? this.src.slice(index, Math.max(index + 1, this.pos));
    throw new CelSyntaxError(message, {
      index,
      source,
      line: this.line,
      message,
      category: options.category ?? 'syntax',
      suggestion: options.suggestion,
    });
  }
}

function isIdentStart(ch: string): boolean {
  return /[A-Za-z_]/.test(ch);
}

function isIdentPart(ch: string): boolean {
  return /[A-Za-z0-9_]/.test(ch);
}

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

function readIdent(s: Scanner): string {
  if (!isIdentStart(s.peek())) s.fail('expected a name');
  const start = s.pos;
  let out = '';
  while (!s.eof && isIdentPart(s.peek())) out += s.advance();
  if (FORBIDDEN_KEYS.has(out)) {
    s.fail(`"${out}" is not an allowed name`, { index: start, source: out });
  }
  return out;
}

/**
 * Unquoted value inside a selector, or an unquoted name after `use`. Looser
 * than an identifier because instance ids and variant ids contain hyphens.
 */
function readBareWord(s: Scanner): string {
  const start = s.pos;
  let out = '';
  while (!s.eof && /[A-Za-z0-9_.-]/.test(s.peek())) out += s.advance();
  if (!out) s.fail('expected a value');
  if (FORBIDDEN_KEYS.has(out)) {
    s.fail(`"${out}" is not an allowed name`, { index: start, source: out });
  }
  return out;
}

const NUMERIC = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;

/**
 * Value inside a selector. Bare words win over numbers unless the whole run
 * is numeric, so hex instance ids like `8ae` are not read as an index.
 */
function readSelectorValue(s: Scanner, limits: CelLimits): CelLiteral {
  const quote = s.peek();
  if (quote === '"' || quote === "'" || quote === '[' || quote === '{') {
    return parseValue(s, limits);
  }
  let run = '';
  let i = 0;
  while (/[A-Za-z0-9_.+-]/.test(s.peek(i))) run += s.peek(i++);
  if (!run) s.fail('expected a value');
  if (run === 'true' || run === 'false') {
    s.advance(run.length);
    return run === 'true';
  }
  if (run === 'null') {
    s.advance(run.length);
    return null;
  }
  if (NUMERIC.test(run)) return readNumber(s);
  return readBareWord(s);
}

function peekIdent(s: Scanner): string | undefined {
  if (!isIdentStart(s.peek())) return undefined;
  let out = '';
  let i = 0;
  while (isIdentPart(s.peek(i))) out += s.peek(i++);
  return out;
}

function readString(s: Scanner): string {
  const start = s.pos;
  const quote = s.advance();
  let out = '';
  while (true) {
    if (s.eof) s.fail('unterminated string', { index: start });
    const ch = s.advance();
    if (ch === quote) return out;
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    const esc = s.advance();
    switch (esc) {
      case 'n':
        out += '\n';
        break;
      case 't':
        out += '\t';
        break;
      case 'r':
        out += '\r';
        break;
      case 'b':
        out += '\b';
        break;
      case 'f':
        out += '\f';
        break;
      case 'u': {
        const hex = s.advance(4);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) s.fail('invalid unicode escape');
        out += String.fromCharCode(parseInt(hex, 16));
        break;
      }
      case '\\':
      case '/':
      case '"':
      case "'":
        out += esc;
        break;
      default:
        s.fail(`invalid escape sequence "\\${esc}"`);
    }
  }
}

function readNumber(s: Scanner): number {
  const start = s.pos;
  let raw = '';
  if (s.peek() === '-') raw += s.advance();
  while (isDigit(s.peek())) raw += s.advance();
  if (s.peek() === '.') {
    raw += s.advance();
    while (isDigit(s.peek())) raw += s.advance();
  }
  if (s.peek() === 'e' || s.peek() === 'E') {
    raw += s.advance();
    if (s.peek() === '+' || s.peek() === '-') raw += s.advance();
    while (isDigit(s.peek())) raw += s.advance();
  }
  const value = Number(raw);
  if (raw === '' || raw === '-' || !Number.isFinite(value)) {
    s.fail(`invalid number "${raw}"`, { index: start, source: raw || '-' });
  }
  return value;
}

function atValueStart(s: Scanner): boolean {
  const ch = s.peek();
  if (ch === '"' || ch === "'" || ch === '[' || ch === '{' || ch === '-') {
    return true;
  }
  if (isDigit(ch)) return true;
  const ident = peekIdent(s);
  return ident !== undefined && LITERAL_KEYWORDS.has(ident);
}

function parseValue(s: Scanner, limits: CelLimits, depth = 1): CelLiteral {
  if (depth > limits.maxValueDepth) {
    s.fail(
      `value nesting exceeds the maximum depth of ${limits.maxValueDepth}`,
      { category: 'limit' }
    );
  }
  s.skipTrivia();
  const ch = s.peek();

  if (ch === '"' || ch === "'") return readString(s);
  if (ch === '-' || isDigit(ch)) return readNumber(s);

  if (ch === '[') {
    s.advance();
    const items: CelLiteral[] = [];
    s.skipTrivia();
    if (s.peek() === ']') {
      s.advance();
      return items;
    }
    while (true) {
      items.push(parseValue(s, limits, depth + 1));
      s.skipTrivia();
      if (s.peek() === ',') {
        s.advance();
        s.skipTrivia();
        if (s.peek() === ']') {
          s.advance();
          return items;
        }
        continue;
      }
      if (s.peek() === ']') {
        s.advance();
        return items;
      }
      s.fail('expected "," or "]" in array');
    }
  }

  if (ch === '{') {
    s.advance();
    const obj: { [key: string]: CelLiteral } = {};
    s.skipTrivia();
    if (s.peek() === '}') {
      s.advance();
      return obj;
    }
    while (true) {
      s.skipTrivia();
      const keyStart = s.pos;
      const key =
        s.peek() === '"' || s.peek() === "'" ? readString(s) : readIdent(s);
      if (FORBIDDEN_KEYS.has(key)) {
        s.fail(`"${key}" is not an allowed key`, {
          index: keyStart,
          source: key,
        });
      }
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        s.fail(`duplicate key "${key}"`, { index: keyStart, source: key });
      }
      s.skipTrivia();
      if (s.peek() !== ':') s.fail('expected ":" after object key');
      s.advance();
      obj[key] = parseValue(s, limits, depth + 1);
      s.skipTrivia();
      if (s.peek() === ',') {
        s.advance();
        s.skipTrivia();
        if (s.peek() === '}') {
          s.advance();
          return obj;
        }
        continue;
      }
      if (s.peek() === '}') {
        s.advance();
        return obj;
      }
      s.fail('expected "," or "}" in object');
    }
  }

  const ident = peekIdent(s);
  if (ident && LITERAL_KEYWORDS.has(ident)) {
    s.advance(ident.length);
    if (ident === 'true') return true;
    if (ident === 'false') return false;
    return null;
  }

  s.fail('expected a value (string, number, boolean, null, array or object)');
}

function parsePath(s: Scanner, limits: CelLimits): CelPath {
  const start = s.pos;
  const root = readIdent(s);
  if (DENIED_ROOT_KEYS.has(root)) {
    s.fail(`"${root}" cannot be changed by a variant`, {
      index: start,
      source: root,
      category: 'denied-field',
    });
  }
  if (!Object.prototype.hasOwnProperty.call(FIELD_META, root)) {
    s.fail(`"${root}" is not a known configuration field`, {
      index: start,
      source: root,
      category: 'unknown-field',
      suggestion: nearestMatch(root, targetableRoots()),
    });
  }

  const segments: CelPathSegment[] = [];
  while (!s.eof) {
    if (s.peek() === '.') {
      s.advance();
      segments.push({ kind: 'key', name: readIdent(s) });
    } else if (s.peek() === '[') {
      s.advance();
      s.skipTrivia();
      if (s.peek() === '*' && s.peek(1) === ']') {
        s.advance();
        segments.push({ kind: 'all' });
      } else if (
        isDigit(s.peek()) ||
        (s.peek() === '-' && isDigit(s.peek(1)))
      ) {
        const indexStart = s.pos;
        const index = readNumber(s);
        if (!Number.isInteger(index)) {
          s.fail('array index must be a whole number', { index: indexStart });
        }
        segments.push({ kind: 'index', index });
      } else {
        // No key means the element itself, for lists of plain values.
        let key = '';
        if (isIdentStart(s.peek())) {
          key = readIdent(s);
          while (s.peek() === '.') {
            s.advance();
            key += `.${readIdent(s)}`;
          }
        }
        s.skipTrivia();
        let operator: CelFilterOperator;
        if (s.peek() === '!' && s.peek(1) === '*' && s.peek(2) === '=') {
          s.advance(3);
          operator = '!*=';
        } else if (s.peek() === '!' && s.peek(1) === '=') {
          s.advance(2);
          operator = '!=';
        } else if (s.peek() === '*' && s.peek(1) === '=') {
          s.advance(2);
          operator = '*=';
        } else if (s.peek() === '=') {
          s.advance();
          operator = '=';
        } else {
          s.fail('expected "=", "!=", "*=" or "!*=" in selector');
        }
        s.skipTrivia();
        const value = readSelectorValue(s, limits);
        segments.push({ kind: 'filter', key, operator, value });
      }
      s.skipTrivia();
      if (s.peek() !== ']') s.fail('expected "]"');
      s.advance();
    } else {
      break;
    }
    if (segments.length > limits.maxPathSegments) {
      s.fail(`path exceeds the maximum of ${limits.maxPathSegments} segments`, {
        index: start,
        category: 'limit',
      });
    }
  }

  return { root, segments, raw: s.src.slice(start, s.pos), index: start };
}

function parseValueList(s: Scanner, limits: CelLimits): CelLiteral[] {
  const values: CelLiteral[] = [];
  s.skipTrivia();
  if (!atValueStart(s)) return values;
  values.push(parseValue(s, limits));
  while (true) {
    s.skipTrivia();
    if (s.peek() !== ',') return values;
    s.advance();
    values.push(parseValue(s, limits));
  }
}

function parseName(s: Scanner): string {
  return s.peek() === '"' || s.peek() === "'" ? readString(s) : readBareWord(s);
}

function parseStatement(s: Scanner, limits: CelLimits): CelStatement {
  const index = s.pos;
  const line = s.line;
  const keyword = readIdent(s);
  if (!VERBS.has(keyword)) {
    s.fail(`unknown instruction "${keyword}"`, {
      index,
      source: keyword,
      category: 'unknown-verb',
      suggestion: nearestMatch(keyword, [...VERBS]),
    });
  }
  s.skipTrivia();

  switch (keyword) {
    case 'set':
    case 'merge': {
      const path = parsePath(s, limits);
      s.skipTrivia();
      if (s.peek() !== '=') s.fail(`expected "=" after the path in ${keyword}`);
      s.advance();
      const value = parseValue(s, limits);
      if (
        keyword === 'merge' &&
        (value === null || typeof value !== 'object')
      ) {
        s.fail('merge requires an object or array value', { index });
      }
      return { op: keyword, path, value, index, line };
    }
    case 'unset':
    case 'clear':
    case 'enable':
    case 'disable':
      return { op: keyword, path: parsePath(s, limits), index, line };
    case 'add':
    case 'prepend':
    case 'remove': {
      const path = parsePath(s, limits);
      const values = parseValueList(s, limits);
      if (values.length === 0 && keyword !== 'remove') {
        s.fail(`${keyword} requires at least one value`, { index });
      }
      return { op: keyword, path, values, index, line };
    }
    default: {
      const kindStart = s.pos;
      const kind = readIdent(s);
      s.skipTrivia();
      if (kind === 'formatter') {
        return { op: 'useFormatter', name: parseName(s), index, line };
      }
      if (kind === 'variant') {
        const idStart = s.pos;
        const id = parseName(s);
        if (!VARIANT_ID_PATTERN.test(id)) {
          s.fail(`invalid variant id "${id}"`, { index: idStart, source: id });
        }
        return { op: 'useVariant', id, index, line };
      }
      return s.fail('expected "use formatter" or "use variant"', {
        index: kindStart,
        source: kind,
        suggestion: nearestMatch(kind, ['formatter', 'variant']),
      });
    }
  }
}

export interface CelParseResult {
  program: CelProgram;
  diagnostics: CelDiagnostic[];
}

/** Parses a script, never throwing. Errors are returned as diagnostics. */
export function parseCelScript(
  script: string,
  limits: CelLimits = DEFAULT_CEL_LIMITS
): CelParseResult {
  const statements: CelStatement[] = [];
  const referencedVariants: string[] = [];
  const diagnostics: CelDiagnostic[] = [];

  if (script.length > limits.maxScriptLength) {
    diagnostics.push({
      index: limits.maxScriptLength,
      source: script.slice(limits.maxScriptLength, limits.maxScriptLength + 20),
      line: 1,
      message: `script exceeds the maximum length of ${limits.maxScriptLength} characters`,
      category: 'limit',
      severity: 'error',
    });
    return { program: { statements, referencedVariants }, diagnostics };
  }

  const s = new Scanner(script);
  while (true) {
    s.skipTrivia();
    if (s.eof) break;
    const index = s.pos;
    const line = s.line;
    try {
      const statement = parseStatement(s, limits);
      statements.push(statement);
      if (statement.op === 'useVariant') {
        referencedVariants.push(statement.id);
      }
      if (statements.length > limits.maxInstructions) {
        diagnostics.push({
          index,
          source: script.slice(index, s.pos),
          line,
          message: `script exceeds the maximum of ${limits.maxInstructions} instructions`,
          category: 'limit',
          severity: 'error',
        });
        break;
      }
    } catch (error) {
      if (error instanceof CelSyntaxError) {
        diagnostics.push({ ...error.diagnostic, severity: 'error' });
      } else {
        diagnostics.push({
          index,
          source: script.slice(index, s.pos) || ' ',
          line,
          message: error instanceof Error ? error.message : String(error),
          category: 'syntax',
          severity: 'error',
        });
      }
      s.skipToNextLine();
    }
  }

  return { program: { statements, referencedVariants }, diagnostics };
}

export class CelError extends Error {
  constructor(
    message: string,
    readonly diagnostic?: CelDiagnostic
  ) {
    super(message);
    this.name = 'CelError';
  }
}

/** Parses a script, throwing `CelError` on the first error. */
export function compileCelScript(
  script: string,
  limits: CelLimits = DEFAULT_CEL_LIMITS
): CelProgram {
  const { program, diagnostics } = parseCelScript(script, limits);
  const error = diagnostics.find((d) => d.severity === 'error');
  if (error) {
    throw new CelError(`line ${error.line}: ${error.message}`, error);
  }
  return program;
}

// ---------------------------------------------------------------------------
// Highlighting
// ---------------------------------------------------------------------------

export type CelTokenKind =
  | 'comment'
  | 'verb'
  | 'root'
  | 'property'
  | 'operator'
  | 'string'
  | 'number'
  | 'keyword'
  | 'punct';

export interface CelToken {
  kind: CelTokenKind;
  start: number;
  end: number;
}

/** Lexes for highlighting only, so unlike the parser it tolerates partial input. */
export function tokenizeCel(src: string): CelToken[] {
  const tokens: CelToken[] = [];
  let pos = 0;
  let atLineStart = true;
  let afterVerb = false;
  let afterDot = false;

  const push = (kind: CelTokenKind, start: number, end: number) =>
    tokens.push({ kind, start, end });

  while (pos < src.length) {
    const ch = src[pos];

    if (ch === '\n') {
      atLineStart = true;
      pos++;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      pos++;
      continue;
    }
    if (ch === '#') {
      const start = pos;
      while (pos < src.length && src[pos] !== '\n') pos++;
      push('comment', start, pos);
      atLineStart = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const start = pos;
      pos++;
      while (pos < src.length && src[pos] !== ch) {
        if (src[pos] === '\\') pos++;
        pos++;
      }
      if (pos < src.length) pos++;
      push('string', start, pos);
      atLineStart = false;
      afterVerb = false;
      afterDot = false;
      continue;
    }
    if (isDigit(ch) || (ch === '-' && isDigit(src[pos + 1] ?? ''))) {
      const start = pos;
      pos++;
      while (pos < src.length && /[0-9.eE+-]/.test(src[pos])) pos++;
      push('number', start, pos);
      atLineStart = false;
      afterVerb = false;
      afterDot = false;
      continue;
    }
    if (isIdentStart(ch)) {
      const start = pos;
      while (pos < src.length && isIdentPart(src[pos])) pos++;
      const word = src.slice(start, pos);
      if (LITERAL_KEYWORDS.has(word)) push('keyword', start, pos);
      else if (atLineStart && VERBS.has(word)) {
        push('verb', start, pos);
        afterVerb = true;
      } else if (afterVerb && !afterDot) {
        push(
          word === 'formatter' || word === 'variant' ? 'verb' : 'root',
          start,
          pos
        );
        afterVerb = word === 'formatter' || word === 'variant';
      } else {
        push('property', start, pos);
      }
      atLineStart = false;
      afterDot = false;
      continue;
    }
    if (ch === '=' || ch === '!' || ch === '*') {
      const start = pos;
      while (pos < src.length && /[=!*]/.test(src[pos])) pos++;
      push('operator', start, pos);
      atLineStart = false;
      continue;
    }

    afterDot = ch === '.';
    push('punct', pos, pos + 1);
    pos++;
    atLineStart = false;
  }

  return tokens;
}

// ---------------------------------------------------------------------------
// Applier
// ---------------------------------------------------------------------------

export interface CelApplyOptions {
  /** Resolves `use variant <id>`. Omit to make those instructions a no-op. */
  resolveVariant?: (id: string) => CelProgram | undefined;
  /** Variant ids already active, which `use variant` must not re-apply. */
  activeVariants?: Iterable<string>;
  maxDepth?: number;
  limits?: CelLimits;
}

export interface CelApplyResult {
  userData: UserData;
  /** Instructions that could not be applied. Never fatal. */
  notes: CelDiagnostic[];
  /** Roots the program actually wrote to. */
  touchedRoots: Set<string>;
}

interface Target {
  container: any;
  key: string | number;
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneLiteral<T extends CelLiteral>(value: T): T {
  if (Array.isArray(value)) return value.map(cloneLiteral) as T;
  if (isPlainObject(value)) {
    const out: Record<string, CelLiteral> = {};
    for (const [key, item] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(key)) continue;
      out[key] = cloneLiteral(item as CelLiteral);
    }
    return out as T;
  }
  return value;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => deepEqual(item, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    return (
      aKeys.length === bKeys.length &&
      aKeys.every(
        (key) =>
          Object.prototype.hasOwnProperty.call(b, key) &&
          deepEqual(a[key], b[key])
      )
    );
  }
  return false;
}

/** RFC 7396 semantics: objects recurse, arrays replace, a null member deletes. */
function deepMerge(base: unknown, patch: CelLiteral): CelLiteral {
  if (!isPlainObject(patch)) return cloneLiteral(patch);
  const out: Record<string, any> = isPlainObject(base) ? { ...base } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (FORBIDDEN_KEYS.has(key)) continue;
    if (value === null) delete out[key];
    else out[key] = deepMerge(out[key], value as CelLiteral);
  }
  return out;
}

function assign(container: any, key: string | number, value: unknown): void {
  if (typeof key === 'string' && FORBIDDEN_KEYS.has(key)) return;
  container[key] = value;
}

function normaliseIndex(index: number, length: number): number | undefined {
  const resolved = index < 0 ? length + index : index;
  return resolved >= 0 && resolved < length ? resolved : undefined;
}

function matchesFilter(
  element: unknown,
  segment: Extract<CelPathSegment, { kind: 'filter' }>
): boolean {
  if (segment.key && !isPlainObject(element)) return false;
  let actual: unknown = element;
  for (const part of segment.key ? segment.key.split('.') : []) {
    if (!isPlainObject(actual)) return segment.operator.startsWith('!');
    actual = actual[part];
  }
  const comparable =
    actual !== undefined &&
    actual !== null &&
    (typeof segment.value !== 'object' || segment.value === null);

  let hit: boolean;
  if (segment.operator === '*=' || segment.operator === '!*=') {
    hit =
      comparable &&
      String(actual)
        .toLowerCase()
        .includes(String(segment.value).toLowerCase());
  } else {
    // String coercion so `[enabled=true]` and `[instanceId=abc]` both read well.
    hit =
      deepEqual(actual, segment.value) ||
      (comparable && String(actual) === String(segment.value));
  }

  return segment.operator === '!=' || segment.operator === '!*=' ? !hit : hit;
}

/** Missing objects are materialised only for plain key segments: the shape of
 * an array element cannot be guessed. */
function step(nodes: any[], segment: CelPathSegment, seed: any): any[] {
  const out: any[] = [];
  for (const node of nodes) {
    switch (segment.kind) {
      case 'key': {
        if (!isPlainObject(node)) break;
        if (node[segment.name] === undefined && seed !== undefined) {
          assign(node, segment.name, seed);
        }
        if (node[segment.name] !== undefined) out.push(node[segment.name]);
        break;
      }
      case 'index': {
        if (!Array.isArray(node)) break;
        const index = normaliseIndex(segment.index, node.length);
        if (index !== undefined) out.push(node[index]);
        break;
      }
      case 'all':
        if (Array.isArray(node)) out.push(...node);
        break;
      case 'filter':
        if (Array.isArray(node)) {
          out.push(...node.filter((el) => matchesFilter(el, segment)));
        }
        break;
    }
  }
  return out;
}

/** Resolves a path to the (container, key) pairs it addresses. */
function resolveTargets(config: any, path: CelPath, create: boolean): Target[] {
  const segments: CelPathSegment[] = [
    { kind: 'key', name: path.root },
    ...path.segments,
  ];
  const last = segments[segments.length - 1];

  let nodes: any[] = [config];
  for (let i = 0; i < segments.length - 1; i++) {
    const seed = create
      ? segments[i + 1].kind === 'key'
        ? {}
        : []
      : undefined;
    nodes = step(nodes, segments[i], seed);
    if (nodes.length === 0) return [];
  }

  const targets: Target[] = [];
  for (const node of nodes) {
    switch (last.kind) {
      case 'key':
        if (isPlainObject(node)) {
          targets.push({ container: node, key: last.name });
        }
        break;
      case 'index': {
        if (!Array.isArray(node)) break;
        const index = normaliseIndex(last.index, node.length);
        if (index !== undefined) targets.push({ container: node, key: index });
        break;
      }
      case 'all':
        if (Array.isArray(node)) {
          node.forEach((_, i) => targets.push({ container: node, key: i }));
        }
        break;
      case 'filter':
        if (Array.isArray(node)) {
          node.forEach((el, i) => {
            if (matchesFilter(el, last)) {
              targets.push({ container: node, key: i });
            }
          });
        }
        break;
    }
  }
  return targets;
}

/** Splices by descending index so earlier removals do not shift later ones. */
function removeTargets(targets: Target[]): void {
  const byArray = new Map<any[], number[]>();
  for (const target of targets) {
    if (Array.isArray(target.container) && typeof target.key === 'number') {
      const indices = byArray.get(target.container) ?? [];
      indices.push(target.key);
      byArray.set(target.container, indices);
    } else if (isPlainObject(target.container)) {
      delete target.container[target.key as string];
    }
  }
  for (const [array, indices] of byArray) {
    for (const index of [...new Set(indices)].sort((a, b) => b - a)) {
      array.splice(index, 1);
    }
  }
}

function note(
  statement: CelStatement,
  message: string,
  category: CelDiagnosticCategory
): CelDiagnostic {
  const source =
    'path' in statement ? statement.path.raw : `use ${statement.op}`;
  return {
    index: 'path' in statement ? statement.path.index : statement.index,
    source,
    line: statement.line,
    message,
    category,
    severity: 'warning',
  };
}

function runProgram(
  config: any,
  program: CelProgram,
  options: CelApplyOptions,
  notes: CelDiagnostic[],
  touchedRoots: Set<string>,
  visiting: Set<string>,
  depth: number
): void {
  const maxDepth = options.maxDepth ?? 5;
  const limits = options.limits ?? DEFAULT_CEL_LIMITS;

  for (const statement of program.statements) {
    if (statement.op === 'useVariant') {
      if (depth >= maxDepth) {
        notes.push(
          note(
            statement,
            `variant nesting exceeds the maximum depth of ${maxDepth}`,
            'limit'
          )
        );
        continue;
      }
      if (visiting.has(statement.id)) {
        notes.push(
          note(
            statement,
            `variant "${statement.id}" is already being applied`,
            'unknown-variant'
          )
        );
        continue;
      }
      const nested = options.resolveVariant?.(statement.id);
      if (!nested) {
        notes.push(
          note(
            statement,
            `unknown variant "${statement.id}"`,
            'unknown-variant'
          )
        );
        continue;
      }
      visiting.add(statement.id);
      runProgram(
        config,
        nested,
        options,
        notes,
        touchedRoots,
        visiting,
        depth + 1
      );
      visiting.delete(statement.id);
      continue;
    }

    if (statement.op === 'useFormatter') {
      const saved = config?.formatter?.definitions?.saved?.[statement.name];
      if (!saved) {
        notes.push(
          note(
            statement,
            `no saved formatter named "${statement.name}"`,
            'unknown-formatter'
          )
        );
        continue;
      }
      config.formatter = {
        ...config.formatter,
        id: 'custom',
        selectedSaved: undefined,
        definitions: {
          ...config.formatter?.definitions,
          custom: { name: saved.name, description: saved.description },
        },
      };
      touchedRoots.add('formatter');
      continue;
    }

    const create =
      statement.op === 'set' ||
      statement.op === 'merge' ||
      statement.op === 'add' ||
      statement.op === 'prepend' ||
      statement.op === 'enable' ||
      statement.op === 'disable';

    const path: CelPath =
      statement.op === 'enable' || statement.op === 'disable'
        ? {
            ...statement.path,
            segments: [
              ...statement.path.segments,
              { kind: 'key', name: 'enabled' },
            ],
          }
        : statement.path;

    const targets = resolveTargets(config, path, create);
    if (targets.length === 0) {
      notes.push(
        note(
          statement,
          `"${statement.path.raw}" matched nothing, instruction skipped`,
          'no-match'
        )
      );
      continue;
    }
    if (targets.length > limits.maxPathMatches) {
      notes.push(
        note(
          statement,
          `"${statement.path.raw}" matched ${targets.length} places, over the limit of ${limits.maxPathMatches}`,
          'limit'
        )
      );
      continue;
    }

    switch (statement.op) {
      case 'set':
        for (const target of targets) {
          assign(target.container, target.key, cloneLiteral(statement.value));
        }
        break;
      case 'enable':
      case 'disable':
        for (const target of targets) {
          assign(target.container, target.key, statement.op === 'enable');
        }
        break;
      case 'merge':
        for (const target of targets) {
          assign(
            target.container,
            target.key,
            deepMerge(target.container[target.key], statement.value)
          );
        }
        break;
      case 'unset':
        removeTargets(targets);
        break;
      case 'clear':
        for (const target of targets) {
          const current = target.container[target.key];
          if (Array.isArray(current)) assign(target.container, target.key, []);
          else if (isPlainObject(current)) {
            assign(target.container, target.key, {});
          } else {
            notes.push(
              note(
                statement,
                `"${statement.path.raw}" is not a list or object, clear skipped`,
                'no-match'
              )
            );
          }
        }
        break;
      case 'add':
      case 'prepend':
        for (const target of targets) {
          let current = target.container[target.key];
          if (current === undefined) {
            current = [];
            assign(target.container, target.key, current);
          }
          if (!Array.isArray(current)) {
            notes.push(
              note(
                statement,
                `"${statement.path.raw}" is not a list, ${statement.op} skipped`,
                'no-match'
              )
            );
            continue;
          }
          const additions = statement.values
            .filter(
              (value) => !current.some((el: unknown) => deepEqual(el, value))
            )
            .map(cloneLiteral);
          if (statement.op === 'add') current.push(...additions);
          else current.unshift(...additions);
        }
        break;
      case 'remove':
        // With no values the path itself selects the elements to drop.
        if (statement.values.length === 0) {
          removeTargets(targets);
          break;
        }
        for (const target of targets) {
          const current = target.container[target.key];
          if (!Array.isArray(current)) {
            notes.push(
              note(
                statement,
                `"${statement.path.raw}" is not a list, remove skipped`,
                'no-match'
              )
            );
            continue;
          }
          assign(
            target.container,
            target.key,
            current.filter(
              (el: unknown) =>
                !statement.values.some((value) => deepEqual(el, value))
            )
          );
        }
        break;
    }

    touchedRoots.add(statement.path.root);
  }
}

/**
 * Applies a program to `config` **in place**. The caller must already own the
 * object. Layering several programs this way avoids a copy per program, which
 * dominates the cost on large configurations.
 */
export function runCelProgram(
  config: UserData,
  program: CelProgram,
  options: CelApplyOptions = {}
): Omit<CelApplyResult, 'userData'> {
  const notes: CelDiagnostic[] = [];
  const touchedRoots = new Set<string>();
  runProgram(
    config,
    program,
    options,
    notes,
    touchedRoots,
    new Set<string>(options.activeVariants ?? []),
    0
  );
  return { notes, touchedRoots };
}

/**
 * Applies a program to a copy of `userData`. The input is never mutated, and an
 * instruction that cannot be applied is recorded as a note rather than failing:
 * config drift must not break install URLs already handed out.
 */
export function applyCelProgram(
  userData: UserData,
  program: CelProgram,
  options: CelApplyOptions = {}
): CelApplyResult {
  const config = structuredClone(userData);
  return { userData: config, ...runCelProgram(config, program, options) };
}
