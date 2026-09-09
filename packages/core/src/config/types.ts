import type { z } from 'zod';

export type ConfigValue =
  | string
  | number
  | boolean
  | null
  | ConfigValue[]
  | { [key: string]: ConfigValue };

export type ConfigSource = 'environment' | 'database' | 'default';

/**
 * Optional per-field UI overrides surfaced verbatim through `describeSettings`.
 */
export interface RuntimeConfigUiOverride {
  /** When the auto-classified `kind === 'string'`, render as a textarea. */
  multiline?: boolean;
  /** Column ratio for `KeyValueListField`. */
  mapWidth?: 'equal' | 'wide-key' | 'wide-value';
  /**
   * Value cell kind for `KeyValueListField`, when the auto-classifier can't
   * infer it (e.g. a record of env-coerced `number | string` size values).
   */
  mapValueKind?:
    | 'string'
    | 'number'
    | 'boolean'
    | 'numberOrBool'
    | 'size'
    | 'json';
  /**
   * Force a specific UI kind, overriding the auto-classifier.
   */
  kind?:
    | 'boolean'
    | 'number'
    | 'string'
    | 'enum'
    | 'list'
    | 'multiEnum'
    | 'map'
    | 'boolOrList'
    | 'duration'
    | 'json';
  /**
   * For `multiEnum` - the order is itself the setting, so it renders as a
   * reorderable list. No schema distinguishes an ordered list from a set.
   */
  orderable?: boolean;
  /** Minimum allowed value for `number` fields (default: 0). */
  min?: number;
  /** Maximum allowed value for `number` fields (default: unbounded). */
  max?: number;
  /** Step size for `number` fields (default: 1). */
  step?: number;
  /**
   * For `enum` - the values offered in the UI, when they are narrower than the
   * ones the schema accepts
   */
  options?: string[];
  /**
   * Hide this field from the generic settings page. Used for fields managed by
   * a bespoke editor elsewhere (e.g. `usenet.providers` lives in the usenet
   * dashboard). The value is still stored/served via that editor, never here.
   */
  hidden?: boolean;
}

/**
 * A field description. Usually a single string shared by the UI and the
 * environment-variable reference. When the env-specific guidance is too long or
 * too format-specific to make sense in the dashboard UI, use the object form:
 * `ui` is shown in the dashboard (and falls back to `env`), while `env` is shown
 * in the generated env-var reference doc and in env validation error messages
 * (and falls back to `ui`).
 */
export type RuntimeConfigDescription = string | { env?: string; ui?: string };

/**
 * Resolve a {@link RuntimeConfigDescription} to a plain string for a given
 * surface. For the string form, returns it verbatim. For the object form,
 * prefers the requested variant and falls back to the other.
 */
export function resolveDescription(
  description: RuntimeConfigDescription,
  variant: 'env' | 'ui'
): string {
  if (typeof description === 'string') return description;
  const other = variant === 'env' ? 'ui' : 'env';
  return description[variant] ?? description[other] ?? '';
}

/**
 * A leaf entry in a runtime config schema. The storage key is derived from the
 * dotted path of the field within its section (e.g. `userLimits.regex.access`).
 */
export interface RuntimeConfigField<T extends ConfigValue = ConfigValue> {
  schema: z.ZodType<T>;
  default: T;
  label: string;
  description: RuntimeConfigDescription;
  /** Environment variable name that overrides the DB-backed value. */
  env: string | null | string[];
  /** If true, changes require a process restart to take effect. */
  requiresRestart: boolean;
  /** If true, the value should be masked in logs and UI. */
  secret: boolean;
  /** Optional UI rendering hints surfaced via `describeSettings`. */
  ui?: RuntimeConfigUiOverride;
  /**
   * Marks the field as deprecated: omitted from the generated env-var
   * reference and hidden from the settings UI unless an override (env or DB)
   * is active, in which case the UI shows a deprecation warning. A string
   * value is the migration guidance shown in that warning.
   */
  deprecated?: boolean | string;
  /**
   * Transforms meant for runtime only i.e. not stored in DB.
   */
  transform?: (value: T) => T;
}

/**
 * A node within a runtime config section: either a leaf field, or a nested
 * subsection of further nodes.
 */
export type RuntimeConfigNode =
  | RuntimeConfigField<any>
  | { [key: string]: RuntimeConfigNode };

/**
 * A whole runtime config section, written as a tree of subsections and leaf
 * fields. Use `satisfies RuntimeConfigSection` on each section's schema to keep
 * concrete field types narrow while validating overall shape.
 */
export type RuntimeConfigSection = { [key: string]: RuntimeConfigNode };

/**
 * Resolve a field's env override. `env` may be a single var name or an ordered
 * list of fallback names (the first one that is set wins). Returns the matched name and
 * its raw value, or undefined if none are set.
 */
export function resolveEnvOverride(
  env: string | string[] | null | undefined
): { name: string; value: string } | undefined {
  if (!env) return undefined;
  for (const name of Array.isArray(env) ? env : [env]) {
    const value = process.env[name];
    if (value !== undefined) return { name, value };
  }
  return undefined;
}

/** The primary (canonical) env var name for a field — the first when it's a list. */
export function primaryEnvName(
  env: string | string[] | null | undefined
): string | null {
  if (!env) return null;
  return Array.isArray(env) ? (env[0] ?? null) : env;
}

export interface RuntimeConfigMetadata {
  key: string;
  label: string;
  description: string;
  env: string | null;
  requiresRestart: boolean;
  secret: boolean;
  valueType: string;
  default: ConfigValue;
  source: ConfigSource;
  /** Present when the field is deprecated; the migration guidance to show. */
  deprecated?: string;
}

/** Resolve a field's `deprecated` flag to the warning message, or undefined. */
export function deprecationMessage(
  deprecated: boolean | string | undefined
): string | undefined {
  if (!deprecated) return undefined;
  return typeof deprecated === 'string'
    ? deprecated
    : 'This setting is deprecated and will be removed in a future release.';
}

export function isRuntimeConfigField(
  node: unknown
): node is RuntimeConfigField {
  return (
    typeof node === 'object' &&
    node !== null &&
    'schema' in node &&
    'default' in node &&
    'label' in node
  );
}
