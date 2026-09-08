/**
 * Variant activation conditions: a boolean stream expression evaluated against
 * the incoming request, deciding whether a variant applies without being named
 * in the URL.
 */
import {
  StreamExpressionEngine,
  extractLiteralCallArgs,
  testHealthResults,
} from '../parser/streamExpression.js';

export interface VariantRequestContext {
  /** `stream`, `meta`, `catalog`, `manifest.json`, `search`, ... */
  resource: string;
  type?: string;
  id?: string;
  userAgent: string;
  query: Record<string, string>;
  /** Lowercased header names. */
  headers: Record<string, string>;
}

export interface ConditionResources {
  /** Resolved once per request; backs `health('<id>')`. */
  health?: Record<string, boolean>;
  /** Literal pattern to compiled regex, resolved before evaluation. */
  regexes: Map<string, RegExp>;
  regexAllowed: boolean;
}

const MAX_USER_AGENT_LENGTH = 512;

export class VariantConditionEvaluator extends StreamExpressionEngine {
  constructor(context: VariantRequestContext, resources: ConditionResources) {
    super();
    this.setupHealthFunction(resources.health);

    const consts = this.parser.consts;
    consts.userAgent = (context.userAgent ?? '').slice(0, MAX_USER_AGENT_LENGTH);
    consts.resource = context.resource;
    consts.type = context.type ?? '';
    consts.id = context.id ?? '';

    const functions = this.parser.functions;
    functions.query = (name: string) => context.query[String(name)] ?? '';
    functions.header = (name: string) =>
      context.headers[String(name).toLowerCase()] ?? '';
    functions.includes = (haystack: unknown, needle: unknown) =>
      String(haystack).toLowerCase().includes(String(needle).toLowerCase());
    functions.matches = (value: unknown, pattern: string) => {
      if (!resources.regexAllowed) {
        throw new Error('Regex is not permitted on this instance');
      }
      const regex = resources.regexes.get(String(pattern));
      if (!regex) throw new Error('matches() needs a quoted pattern');
      regex.lastIndex = 0;
      return regex.test(String(value));
    };
  }

  /** The stream helpers have no streams to act on here. */
  protected override setupStreamFunctions() {}

  async evaluate(condition: string) {
    return await this.evaluateCondition(condition);
  }

  static async testEvaluate(
    condition: string,
    options: { healthIds?: string[]; patterns?: Map<string, RegExp> } = {}
  ) {
    const evaluator = new VariantConditionEvaluator(
      {
        resource: 'stream',
        type: 'movie',
        id: 'tt0111161',
        userAgent: 'AIOStreams/test',
        query: {},
        headers: { 'user-agent': 'AIOStreams/test' },
      },
      {
        health: testHealthResults(options.healthIds ?? []),
        regexes: options.patterns ?? new Map(),
        regexAllowed: true,
      }
    );
    return await evaluator.evaluate(condition);
  }
}

/** Health check ids a condition reads, so they can be resolved up front. */
export function referencedHealthIds(condition: string): string[] {
  return extractLiteralCallArgs(condition, 'health', 0).map((id) =>
    id.toLowerCase()
  );
}

/** Regex patterns a condition matches against, so they can be compiled up front. */
export function referencedPatterns(condition: string): string[] {
  return extractLiteralCallArgs(condition, 'matches', 1);
}
