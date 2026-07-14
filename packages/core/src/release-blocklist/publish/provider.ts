import type { z } from 'zod';
import { artifactKey, type PublishArtifactSpec } from './types.js';

/** One file handed to a provider, gzip already applied when the spec asks. */
export interface PublishFile {
  artifactKey: string;
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface PublishOutcome {
  /** filename -> stable public URL consumers can subscribe to. */
  urls: Record<string, string>;
  /** Keys merged back into the stored config (e.g. a created gist id). */
  configPatch?: Record<string, unknown>;
}

export interface PublishProviderCapabilities {
  multiFile: boolean;
  /** false: text only, gzip artifacts are rejected. */
  binary: boolean;
  /** Checked against the uploaded (post-gzip) size. */
  maxBytesPerFile?: number;
  /**
   * Most bytes the provider can carry in one API call.
   */
  maxBytesPerRequest?: number;
}

export interface PublishProviderField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'select' | 'switch' | 'textarea';
  required?: boolean;
  secret?: boolean;
  placeholder?: string;
  editPlaceholder?: string;
  help?: string;
  editHelp?: string;
  options?: Array<{ label: string; value: string }>;
  default?: string | boolean;
}

export interface PublishProvider<C = Record<string, unknown>> {
  id: string;
  label: string;
  capabilities: PublishProviderCapabilities;
  fields: PublishProviderField[];
  configSchema: z.ZodType<C>;
  configPatchSchema: z.ZodType<Partial<C>>;
  /**
   * Save-time validation; may do network I/O (verify a token, resolve a
   * default branch). Returns the normalized config to persist. Throws an
   * Error with a user-safe message.
   */
  validateConfig(config: C): Promise<C>;
  publish(config: C, files: PublishFile[]): Promise<PublishOutcome>;
  /** Redacted display summary for the dashboard */
  summarize(config: C): Record<string, unknown>;
  hasCredential(config: C): boolean;
}

const registry = new Map<string, PublishProvider<any>>();

export function registerPublishProvider(provider: PublishProvider<any>): void {
  registry.set(provider.id, provider);
}

export function getPublishProvider(
  id: string
): PublishProvider<any> | undefined {
  return registry.get(id);
}

export function listPublishProviders(): PublishProvider<any>[] {
  return [...registry.values()];
}

/**
 * Validate an artifact list against a provider's capabilities. Shared by the
 * dashboard routes (-> 400) and the publisher (defense in depth). Returns a
 * human-readable problem or null.
 */
export function checkArtifactsAgainstCapabilities(
  provider: PublishProvider<any>,
  artifacts: readonly PublishArtifactSpec[]
): string | null {
  if (artifacts.length === 0) return 'at least one artifact is required';
  const keys = new Set(artifacts.map(artifactKey));
  if (keys.size !== artifacts.length) {
    return 'duplicate format/scope artifact';
  }
  if (artifacts.length > 1 && !provider.capabilities.multiFile) {
    return `${provider.label} supports a single file`;
  }
  for (const artifact of artifacts) {
    if (artifact.gzip && !provider.capabilities.binary) {
      return `${provider.label} cannot store gzipped (binary) files`;
    }
  }
  return null;
}
