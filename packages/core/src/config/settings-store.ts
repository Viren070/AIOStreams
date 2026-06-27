import { z, ZodError } from 'zod';
import { SettingsRepository } from '../db/repositories/settings.js';
import { createLogger } from '../logging/logger.js';
import { formatZodError } from '../utils/format-zod-error.js';
import { encryptString, decryptString } from '../utils/crypto.js';
import {
  isRuntimeConfigField,
  resolveDescription,
  resolveEnvOverride,
  primaryEnvName,
  type ConfigValue,
  type RuntimeConfigField,
  type RuntimeConfigMetadata,
  type RuntimeConfigNode,
} from './types.js';

const logger = createLogger('config');

type SectionSchemas = Record<string, Record<string, RuntimeConfigNode>>;

type SnapshotOf<N> = N extends { schema: z.ZodType<infer T> }
  ? T
  : N extends Record<string, RuntimeConfigNode>
    ? { [K in keyof N]: SnapshotOf<N[K]> }
    : never;

type Snapshot<TSections extends SectionSchemas> = {
  [S in keyof TSections]: {
    [K in keyof TSections[S]]: SnapshotOf<TSections[S][K]>;
  };
};

function valueType(schema: z.ZodType): string {
  const def = (
    schema as z.ZodType & { _def?: { type?: string; typeName?: string } }
  )._def;
  return def?.type ?? def?.typeName ?? 'unknown';
}

function parseEnvValue(raw: string, field: RuntimeConfigField): ConfigValue {
  const trimmed = raw.trim();
  const parsed = (() => {
    if (trimmed === '') return raw;
    try {
      return JSON.parse(trimmed);
    } catch {
      return raw;
    }
  })();
  return field.schema.parse(parsed) as ConfigValue;
}

function makeUninitialisedSectionProxy(sectionName: string): unknown {
  const message = (prop: string | symbol) =>
    `appConfig.${sectionName}.${String(prop)} was read at module-load time, ` +
    `before initialiseConfig() resolved. Move this read inside a function or ` +
    `method so it observes the validated, possibly env/DB-overridden value.`;
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === Symbol.toPrimitive || prop === 'then') return undefined;
        throw new Error(message(prop));
      },
      has(_t, prop) {
        throw new Error(message(prop));
      },
    }
  );
}

/**
 * Thrown from {@link SettingsStore} when env-supplied or built-in default
 * values fail schema validation at startup.
 */
export class ConfigStartupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigStartupError';
  }
}

interface FieldEntry {
  field: RuntimeConfigField;
  /** Path within the schema tree, including the section name as the first element. */
  path: string[];
  /** Storage key (`section.sub.field`). */
  key: string;
}

function* walkFields(
  node: Record<string, RuntimeConfigNode>,
  path: string[]
): Generator<FieldEntry> {
  for (const [name, child] of Object.entries(node)) {
    const childPath = [...path, name];
    if (isRuntimeConfigField(child)) {
      yield { field: child, path: childPath, key: childPath.join('.') };
    } else {
      yield* walkFields(child as Record<string, RuntimeConfigNode>, childPath);
    }
  }
}

function readPath(root: unknown, path: string[]): unknown {
  let cursor: any = root;
  for (const seg of path) {
    if (cursor == null || typeof cursor !== 'object') return undefined;
    cursor = cursor[seg];
  }
  return cursor;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (Array.isArray(b)) return false;
  const aKeys = Object.keys(a as object);
  const bKeys = Object.keys(b as object);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (!deepEqual((a as any)[k], (b as any)[k])) return false;
  }
  return true;
}

function setAtPath(
  root: Record<string, any>,
  path: string[],
  value: ConfigValue
): void {
  let cursor = root;
  for (let i = 0; i < path.length - 1; i++) {
    const seg = path[i];
    if (!cursor[seg] || typeof cursor[seg] !== 'object') cursor[seg] = {};
    cursor = cursor[seg];
  }
  cursor[path[path.length - 1]] = value;
}

export interface SettingsChangeEvent<TSections extends SectionSchemas> {
  /** Dotted storage keys (e.g. `templates.urls`) whose effective value changed. */
  changed: Set<string>;
  /** Previous snapshot (proxy on first emit). */
  previous: Snapshot<TSections>;
  /** Current snapshot. */
  current: Snapshot<TSections>;
}

export type SettingsChangeListener<TSections extends SectionSchemas> = (
  event: SettingsChangeEvent<TSections>
) => void | Promise<void>;

export class SettingsStore<TSections extends SectionSchemas> {
  private snapshot: Snapshot<TSections>;
  private version = 0;
  private storedKeys: Set<string> = new Set();
  private fieldsByKey: Map<string, FieldEntry>;
  private listeners: Set<SettingsChangeListener<TSections>> = new Set();

  constructor(private readonly schemas: TSections) {
    this.fieldsByKey = new Map();
    for (const sectionName of Object.keys(schemas)) {
      const section = schemas[sectionName] as Record<string, RuntimeConfigNode>;
      for (const entry of walkFields(section, [sectionName])) {
        if (this.fieldsByKey.has(entry.key)) {
          throw new Error(`Duplicate config key: ${entry.key}`);
        }
        this.fieldsByKey.set(entry.key, entry);
      }
    }
    // Seed a snapshot where each section is a Proxy that throws on access.
    // This catches any accesses to the config before it's initialised.
    const seed: Record<string, any> = {};
    for (const sectionName of Object.keys(schemas)) {
      seed[sectionName] = makeUninitialisedSectionProxy(sectionName);
    }
    this.snapshot = seed as Snapshot<TSections>;
  }

  get current(): Snapshot<TSections> {
    return this.snapshot;
  }

  /** Monotonic settings version (bumped by every DB write across all replicas). */
  get currentVersion(): number {
    return this.version;
  }

  get metadata(): RuntimeConfigMetadata[] {
    const result: RuntimeConfigMetadata[] = [];
    const storedKeysCache = this.storedKeys;
    for (const { field, key } of this.fieldsByKey.values()) {
      result.push({
        key,
        label: field.label,
        description: resolveDescription(field.description, 'ui'),
        env: primaryEnvName(field.env),
        requiresRestart: field.requiresRestart,
        secret: field.secret,
        valueType: valueType(field.schema),
        default: field.default,
        source: resolveEnvOverride(field.env)
          ? 'environment'
          : storedKeysCache.has(key)
            ? 'database'
            : 'default',
      });
    }
    return result;
  }

  async initialise(): Promise<void> {
    await this.reload({ emit: false });
  }

  async reload(options: { emit?: boolean } = {}): Promise<Set<string>> {
    const emit = options.emit !== false;
    const previous = this.snapshot;
    const rows = await SettingsRepository.getAll();
    const stored = new Map<string, unknown>();
    for (const row of rows) {
      try {
        const decoded = this.decodeFromStorage(row.key, JSON.parse(row.value));
        if (decoded !== undefined) stored.set(row.key, decoded);
      } catch (error) {
        logger.warn({ key: row.key, error }, 'Ignoring invalid stored setting');
      }
    }
    this.storedKeys = new Set(stored.keys());
    this.snapshot = this.buildSnapshot(stored);
    this.version = await SettingsRepository.getVersion();
    if (!emit) return new Set();
    const changed = this.diffKeys(previous, this.snapshot);
    if (changed.size > 0) {
      await this.emitChange(changed, previous);
    }
    return changed;
  }

  async refreshIfChanged(): Promise<boolean> {
    const nextVersion = await SettingsRepository.getVersion();
    if (nextVersion === this.version) return false;
    logger.info(
      { currentVersion: this.version, nextVersion },
      'Detected changed settings version; reloading'
    );
    await this.reload();
    return true;
  }

  /**
   * Subscribe to settings changes. The listener fires after every `set`,
   * `delete`, or DB-driven `reload` that actually changes the effective value
   * of at least one field. Returns an unsubscribe function.
   */
  subscribe(listener: SettingsChangeListener<TSections>): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private async emitChange(
    changed: Set<string>,
    previous: Snapshot<TSections>
  ): Promise<void> {
    const event: SettingsChangeEvent<TSections> = {
      changed,
      previous,
      current: this.snapshot,
    };
    for (const listener of this.listeners) {
      try {
        await listener(event);
      } catch (err) {
        logger.error(
          { err: err instanceof Error ? err.message : String(err) },
          'settings change listener threw'
        );
      }
    }
  }

  private diffKeys(
    previous: Snapshot<TSections>,
    current: Snapshot<TSections>
  ): Set<string> {
    const changed = new Set<string>();
    for (const { path, key } of this.fieldsByKey.values()) {
      const prev = readPath(previous, path);
      const next = readPath(current, path);
      if (!deepEqual(prev, next)) changed.add(key);
    }
    return changed;
  }

  async set(key: string, value: unknown, updatedBy?: string): Promise<void> {
    const entry = this.requireField(key);
    const parsed = entry.field.schema.parse(value);
    const override = resolveEnvOverride(entry.field.env);
    if (override) {
      throw new Error(`Setting ${key} is overridden by ${override.name}`);
    }
    await SettingsRepository.set(
      key,
      this.encodeForStorage(key, parsed as ConfigValue),
      updatedBy
    );
    await this.reload();
  }

  async delete(key: string): Promise<void> {
    const entry = this.requireField(key);
    const override = resolveEnvOverride(entry.field.env);
    if (override) {
      throw new Error(`Setting ${key} is overridden by ${override.name}`);
    }
    await SettingsRepository.delete(key);
    await this.reload();
  }

  getEffectiveValue(key: string): ConfigValue {
    const entry = this.requireField(key);
    let cursor: any = this.snapshot;
    for (const seg of entry.path) {
      if (cursor == null || typeof cursor !== 'object' || !(seg in cursor)) {
        throw new Error(`Unknown setting: ${key}`);
      }
      cursor = cursor[seg];
    }
    return cursor as ConfigValue;
  }

  private buildSnapshot(stored: Map<string, unknown>): Snapshot<TSections> {
    const snapshot: Record<string, any> = {};
    for (const sectionName of Object.keys(this.schemas)) {
      snapshot[sectionName] = {};
    }

    type ConfigError = {
      source: 'env' | 'default';
      label: string;
      key: string;
      value: string;
      message: string;
      description: string;
    };
    const fatalErrors: ConfigError[] = [];

    const applyTransform = (
      field: RuntimeConfigField,
      value: ConfigValue
    ): ConfigValue => (field.transform ? field.transform(value) : value);

    const parseDefault = (
      field: RuntimeConfigField,
      key: string
    ): ConfigValue | undefined => {
      try {
        const parsed = field.schema.parse(field.default) as ConfigValue;
        return applyTransform(field, parsed);
      } catch (err) {
        fatalErrors.push({
          source: 'default',
          label: `default for ${key}`,
          key,
          value: field.secret ? '(secret)' : JSON.stringify(field.default),
          message: formatZodError(err as ZodError, {
            continuationIndent: ' '.repeat(19),
          }),
          description: resolveDescription(field.description, 'env'),
        });
        return undefined;
      }
    };

    for (const { field, path, key } of this.fieldsByKey.values()) {
      const override = resolveEnvOverride(field.env);
      const rawEnv = override?.value;

      let value: ConfigValue | undefined;
      if (rawEnv !== undefined) {
        try {
          value = applyTransform(field, parseEnvValue(rawEnv, field));
        } catch (err) {
          fatalErrors.push({
            source: 'env',
            label: override!.name,
            key,
            value: field.secret ? '(secret)' : rawEnv,
            message: formatZodError(err as ZodError, {
              continuationIndent: ' '.repeat(19),
            }),
            description: resolveDescription(field.description, 'env'),
          });
          continue;
        }
      } else if (stored.has(key)) {
        try {
          value = applyTransform(
            field,
            field.schema.parse(stored.get(key)) as ConfigValue
          );
        } catch (err) {
          logger.warn(
            {
              key,
              err: formatZodError(err as ZodError),
              storedValue: field.secret ? '(secret)' : stored.get(key),
            },
            'Stored setting failed validation; falling back to default'
          );
          value = parseDefault(field, key);
        }
      } else {
        value = parseDefault(field, key);
      }

      if (value === undefined) continue;
      // path[0] is the section name; nest under that
      setAtPath(snapshot[path[0]], path.slice(1), value as ConfigValue);
    }

    if (fatalErrors.length > 0) {
      const envErrors = fatalErrors.filter((e) => e.source === 'env');
      const defaultErrors = fatalErrors.filter((e) => e.source === 'default');
      const lines: string[] = ['', '='.repeat(60)];
      if (envErrors.length > 0) {
        lines.push(' Invalid environment variable configuration:');
        lines.push('='.repeat(60));
        for (const { label, value, message, description } of envErrors) {
          lines.push(`    ${label}=${value}`);
          lines.push(`      Error:       ${message}`);
          lines.push(`      Description: ${description}`);
          lines.push('');
        }
      }
      if (defaultErrors.length > 0) {
        lines.push(' Invalid built-in schema defaults (this is a bug):');
        lines.push('='.repeat(60));
        for (const { key, value, message, description } of defaultErrors) {
          lines.push(`    ${key}  default=${value}`);
          lines.push(`      Error:       ${message}`);
          lines.push(`      Description: ${description}`);
          lines.push('');
        }
      }
      lines.push('='.repeat(60));
      lines.push('');
      throw new ConfigStartupError(lines.join('\n'));
    }

    return snapshot as Snapshot<TSections>;
  }

  private requireField(key: string): FieldEntry {
    const entry = this.fieldsByKey.get(key);
    if (!entry) throw new Error(`Unknown setting: ${key}`);
    return entry;
  }

  /**
   * Encrypt the persisted form of a `secret: true` field at rest. Non-secret
   * fields are stored verbatim. The encrypted form is a `{ __enc }` envelope so
   * {@link decodeFromStorage} can transparently distinguish it from any
   * previously-plaintext secret value (back-compat).
   */
  private encodeForStorage(key: string, value: ConfigValue): unknown {
    const entry = this.fieldsByKey.get(key);
    if (!entry?.field.secret) return value;
    const enc = encryptString(JSON.stringify(value));
    if (!enc.success) {
      throw new Error(`Failed to encrypt secret setting ${key}`);
    }
    return { __enc: enc.data };
  }

  /**
   * Inverse of {@link encodeForStorage}. Returns the decrypted value for secret
   * fields stored as a `{ __enc }` envelope, the raw value for plaintext
   * (legacy) secrets, and `undefined` when decryption fails (so the caller
   * falls back to the default rather than surfacing ciphertext).
   */
  private decodeFromStorage(key: string, parsed: unknown): unknown {
    const entry = this.fieldsByKey.get(key);
    if (!entry?.field.secret) return parsed;
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as { __enc?: unknown }).__enc === 'string'
    ) {
      const dec = decryptString((parsed as { __enc: string }).__enc);
      if (!dec.success || dec.data == null) {
        logger.warn(
          { key },
          'failed to decrypt secret setting; falling back to default'
        );
        return undefined;
      }
      try {
        return JSON.parse(dec.data);
      } catch {
        return dec.data;
      }
    }
    return parsed;
  }
}
