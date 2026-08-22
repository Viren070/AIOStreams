import { config as appConfig } from '../config/index.js';
import { createLogger } from '../logging/logger.js';
import type {
  UserData,
  Variant,
  VariantSelectorLocation,
} from '../db/schemas.js';
import {
  applyCelProgram,
  runCelProgram,
  compileCelScript,
  CelError,
  DEFAULT_CEL_LIMITS,
  parseCelScript,
  VARIANT_ID_PATTERN,
  type CelDiagnostic,
  type CelLimits,
  type CelProgram,
} from './language.js';

const logger = createLogger('variants');

/** Query parameter that selects variants on addon and ChillLink URLs. */
export const VARIANT_QUERY_PARAM = 'v';

/**
 * The selector may instead sit in the path, between the encrypted password and
 * the resource.
 */
export const VARIANT_PATH_SEGMENT = 'v';
export const VARIANT_PATH_PARAM = 'variantSelector';
/** Suffix for a `:uuid/:encryptedPassword` mount path. */
export const VARIANT_PATH_ROUTE = `/${VARIANT_PATH_SEGMENT}/:${VARIANT_PATH_PARAM}`;

export function getVariantLimits(): CelLimits {
  const limits = appConfig.userLimits.variants;
  return {
    maxScriptLength: limits.maxScriptLength,
    maxInstructions: limits.maxInstructions,
    maxValueDepth: limits.maxValueDepth,
    maxPathSegments: limits.maxPathSegments,
    maxPathMatches: limits.maxPathMatches,
  };
}

/** Keyed by source text rather than a hash, so collisions cannot arise. */
const AST_CACHE = new Map<string, CelProgram>();
const AST_CACHE_MAX_ENTRIES = 500;
const AST_CACHE_MAX_CHARS = 512 * 1024;
let astCacheChars = 0;

function compileCached(script: string): CelProgram {
  const hit = AST_CACHE.get(script);
  if (hit) {
    // Re-insert so the map stays insertion-ordered by recency.
    AST_CACHE.delete(script);
    AST_CACHE.set(script, hit);
    return hit;
  }
  const program = compileCelScript(script, getVariantLimits());
  AST_CACHE.set(script, program);
  astCacheChars += script.length;

  while (
    AST_CACHE.size > AST_CACHE_MAX_ENTRIES ||
    astCacheChars > AST_CACHE_MAX_CHARS
  ) {
    const oldest = AST_CACHE.keys().next().value;
    if (oldest === undefined || oldest === script) break;
    AST_CACHE.delete(oldest);
    astCacheChars -= oldest.length;
  }
  return program;
}

export class VariantSelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VariantSelectionError';
  }
}

function variantsEnabled(userData: UserData): boolean {
  const access = appConfig.userLimits.variants.access;
  if (access === 'none') return false;
  if (access === 'trusted') return userData.trusted === true;
  return true;
}

/** Comma separated, applied left to right. */
export function parseVariantSelector(raw: unknown): string[] {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string' || !value.trim()) return [];

  const ids = value
    .split(',')
    .map((id) => id.trim().toLowerCase())
    .filter(Boolean);

  const seen = new Set<string>();
  const unique = ids.filter((id) => !seen.has(id) && seen.add(id));

  const max = appConfig.userLimits.variants.maxActive;
  if (unique.length > max) {
    throw new VariantSelectionError(
      `Too many variants selected (${unique.length}); this instance allows at most ${max}.`
    );
  }
  for (const id of unique) {
    if (!VARIANT_ID_PATTERN.test(id)) {
      throw new VariantSelectionError(`Invalid variant id "${id}".`);
    }
  }
  return unique;
}

export interface ApplyVariantsResult {
  userData: UserData;
  applied: string[];
  notes: CelDiagnostic[];
}

/**
 * Applies the selected variants on top of `userData`. The result must still go
 * through the ordinary `validateConfig`, which is what re-applies operator
 * controls and keeps a variant from producing a config the user could not have
 * saved directly.
 *
 * An unknown or disabled id is a hard error, unlike an instruction that matches
 * nothing: serving the base config under a variant URL would be worse than
 * failing.
 */
export function applyVariants(
  userData: UserData,
  ids: string[]
): ApplyVariantsResult {
  if (ids.length === 0) return { userData, applied: [], notes: [] };

  if (!variantsEnabled(userData)) {
    throw new VariantSelectionError(
      'Config variants are not available on this instance.'
    );
  }

  const byId = new Map<string, Variant>(
    (userData.variants ?? []).map((variant) => [
      variant.id.toLowerCase(),
      variant,
    ])
  );

  const selected: Variant[] = [];
  for (const id of ids) {
    const variant = byId.get(id);
    if (!variant) {
      throw new VariantSelectionError(`Unknown config variant "${id}".`);
    }
    if (variant.enabled === false) {
      throw new VariantSelectionError(`Config variant "${id}" is disabled.`);
    }
    selected.push(variant);
  }

  const resolveVariant = (id: string): CelProgram | undefined => {
    const variant = byId.get(id.toLowerCase());
    if (!variant || variant.enabled === false) return undefined;
    try {
      return compileCached(variant.script);
    } catch {
      return undefined;
    }
  };

  // One copy for the whole chain: cloning is the bulk of the cost here.
  const result = structuredClone(userData);
  const notes: CelDiagnostic[] = [];
  const applied: string[] = [];
  const limits = getVariantLimits();

  for (const variant of selected) {
    let program: CelProgram;
    try {
      program = compileCached(variant.script);
    } catch (error) {
      const detail = error instanceof CelError ? error.message : String(error);
      throw new VariantSelectionError(
        `Config variant "${variant.id}" is invalid: ${detail}`
      );
    }
    const applyResult = runCelProgram(result, program, {
      resolveVariant,
      activeVariants: [variant.id.toLowerCase()],
      maxDepth: appConfig.userLimits.variants.maxDepth,
      limits,
    });
    notes.push(...applyResult.notes);
    applied.push(variant.id.toLowerCase());
  }

  result.activeVariants = applied;
  return { userData: result, applied, notes };
}

/**
 * Save-time validation. Must not call `validateConfig`, which calls this and
 * would recurse; a schema parse of the patched config is the substitute.
 */
export function validateVariants(
  userData: UserData,
  parseConfig: (config: UserData) => { success: boolean; error?: string }
): void {
  const variants = userData.variants;
  if (!variants || variants.length === 0) return;

  const limits = appConfig.userLimits.variants;
  if (!variantsEnabled(userData)) {
    throw new Error(
      'Config variants are not available on this instance. Remove them to save this configuration.'
    );
  }
  if (variants.length > limits.max) {
    throw new Error(
      `Too many config variants (${variants.length}); the maximum is ${limits.max}.`
    );
  }

  const totalCharacters = variants.reduce((sum, v) => sum + v.script.length, 0);
  if (totalCharacters > limits.maxTotalScriptCharacters) {
    throw new Error(
      `Config variant scripts total ${totalCharacters} characters; the maximum is ${limits.maxTotalScriptCharacters}.`
    );
  }

  const celLimits = getVariantLimits();
  const programs = new Map<string, CelProgram>();
  const ids = new Set(variants.map((v) => v.id.toLowerCase()));

  for (const variant of variants) {
    const { program, diagnostics } = parseCelScript(variant.script, celLimits);
    const error = diagnostics.find((d) => d.severity === 'error');
    if (error) {
      throw new Error(
        `Config variant "${variant.id}" line ${error.line}: ${error.message}`
      );
    }
    for (const referenced of program.referencedVariants) {
      if (!ids.has(referenced.toLowerCase())) {
        throw new Error(
          `Config variant "${variant.id}" references unknown variant "${referenced}".`
        );
      }
    }
    programs.set(variant.id.toLowerCase(), program);
  }

  assertNoVariantCycles(programs);

  // Each variant on its own must still yield a schema-valid configuration.
  for (const variant of variants) {
    const program = programs.get(variant.id.toLowerCase())!;
    const { userData: patched } = applyCelProgram(userData, program, {
      resolveVariant: (id) => programs.get(id.toLowerCase()),
      maxDepth: limits.maxDepth,
      limits: celLimits,
    });
    patched.variants = undefined;
    patched.activeVariants = undefined;
    const result = parseConfig(patched);
    if (!result.success) {
      throw new Error(
        `Config variant "${variant.id}" produces an invalid configuration: ${result.error}`
      );
    }
  }
}

function assertNoVariantCycles(programs: Map<string, CelProgram>): void {
  const visiting = new Set<string>();
  const done = new Set<string>();

  const walk = (id: string, trail: string[]): void => {
    if (done.has(id)) return;
    if (visiting.has(id)) {
      throw new Error(
        `Config variants form a loop: ${[...trail, id].join(' -> ')}.`
      );
    }
    visiting.add(id);
    for (const referenced of programs.get(id)?.referencedVariants ?? []) {
      walk(referenced.toLowerCase(), [...trail, id]);
    }
    visiting.delete(id);
    done.add(id);
  };

  for (const id of programs.keys()) walk(id, []);
}

export interface VariantSelection {
  ids: string[];
  location: VariantSelectorLocation;
}

/** The path form wins when both are present: it is the installed one. */
export function resolveVariantSelector(
  pathValue: unknown,
  queryValue: unknown
): VariantSelection {
  const fromPath = parseVariantSelector(pathValue);
  if (fromPath.length) return { ids: fromPath, location: 'path' };
  return { ids: parseVariantSelector(queryValue), location: 'query' };
}

/**
 * `base` must end at the encrypted password, since the path form goes between
 * it and `resource`.
 */
export function withVariantSelector(
  base: string,
  resource: string,
  activeVariants: string[] | undefined,
  location: VariantSelectorLocation = 'query'
): string {
  if (!activeVariants?.length) return `${base}${resource}`;
  const ids = activeVariants.map(encodeURIComponent).join(',');
  if (location === 'path') {
    return `${base}/${VARIANT_PATH_SEGMENT}/${ids}${resource}`;
  }
  const url = `${base}${resource}`;
  return `${url}${url.includes('?') ? '&' : '?'}${VARIANT_QUERY_PARAM}=${ids}`;
}

export function logVariantNotes(
  uuid: string | undefined,
  result: ApplyVariantsResult
) {
  if (!result.notes.length) return;
  logger.debug(
    {
      uuid,
      variants: result.applied,
      notes: result.notes.map((n) => `line ${n.line}: ${n.message}`),
    },
    'applied config variants with notes'
  );
}

export { DEFAULT_CEL_LIMITS };
