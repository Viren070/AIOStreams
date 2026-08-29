import type { Option, Template } from '../db/schemas.js';

// Browser-safe: shared by the SPA's export flow and the server's upload path.

export const REGEX_PATTERN_FIELDS = [
  'excludedRegexPatterns',
  'includedRegexPatterns',
  'requiredRegexPatterns',
  'preferredRegexPatterns',
  'rankedRegexPatterns',
] as const;

export const SYNCED_SEL_URL_FIELDS = [
  'syncedExcludedStreamExpressionUrls',
  'syncedIncludedStreamExpressionUrls',
  'syncedRequiredStreamExpressionUrls',
  'syncedPreferredStreamExpressionUrls',
  'syncedRankedStreamExpressionUrls',
] as const;

export const SYNCED_REGEX_URL_FIELDS = [
  'syncedExcludedRegexUrls',
  'syncedIncludedRegexUrls',
  'syncedRequiredRegexUrls',
  'syncedPreferredRegexUrls',
  'syncedRankedRegexUrls',
] as const;

const TOP_LEVEL_SECRETS = [
  'ip',
  'uuid',
  'accessKey',
  'tmdbAccessToken',
  'tmdbApiKey',
  'tvdbApiKey',
  'rpdbApiKey',
  'topPosterApiKey',
  'aioratingsApiKey',
  'aioratingsProfileId',
  'openposterdbApiKey',
  'openposterdbUrl',
  'openposterdbParameters',
] as const;

export type OptionLookup = (presetType: string) => Option[] | undefined;

/**
 * Extract all possible string leaf values from a template config field that
 * may contain template directives.
 */
export function extractTemplateStrings(value: any): string[] {
  if (typeof value === 'string') return value ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(extractTemplateStrings);
  if (value === null || typeof value !== 'object') return [];

  if ('__value' in value) return extractTemplateStrings(value.__value);

  if ('__switch' in value) {
    const caseVals = Object.values(value.cases ?? {});
    const def = value.default ?? null;
    return [
      ...caseVals.flatMap(extractTemplateStrings),
      ...(def !== null ? extractTemplateStrings(def) : []),
    ];
  }

  if (value.__remove === true) return [];

  if (typeof value.pattern === 'string') return [value.pattern];

  return [];
}

/** Everything a template would whitelist for every user if it were trusted. */
export function collectTrustedStrings(config: any): {
  patterns: string[];
  selUrls: string[];
  regexUrls: string[];
} {
  const ex = (fields: readonly string[]) =>
    fields.flatMap((field) => extractTemplateStrings(config?.[field]));
  return {
    patterns: ex(REGEX_PATTERN_FIELDS),
    selUrls: ex(SYNCED_SEL_URL_FIELDS),
    regexUrls: ex(SYNCED_REGEX_URL_FIELDS),
  };
}

/** Multi-tag metadata with the single legacy `category` as its fallback. */
export function templateTags(metadata: {
  tags?: string[];
  category?: string;
}): string[] {
  if (metadata.tags?.length) return metadata.tags;
  return metadata.category ? [metadata.category.toLowerCase()] : [];
}

export function redactPresetOptions(
  options: Record<string, any> | undefined,
  optionMeta: Option[] | undefined,
  placeholder?: string
): Record<string, any> {
  return Object.fromEntries(
    Object.entries(options ?? {}).flatMap(([id, value]): [string, any][] => {
      const meta = optionMeta?.find((opt) => opt.id === id);
      if (meta?.type === 'password') {
        return placeholder !== undefined && value !== undefined && value !== ''
          ? [[id, placeholder]]
          : [];
      }
      const subOptions = meta?.subOptions as Option[] | undefined;
      if (
        subOptions?.length &&
        value &&
        typeof value === 'object' &&
        !Array.isArray(value)
      ) {
        return [[id, redactPresetOptions(value, subOptions, placeholder)]];
      }
      return [[id, value]];
    })
  );
}

/**
 * Replace the credentials a configuration carries before it becomes a
 * template: top-level keys and identity, service credentials, proxy details
 * and password-typed addon options. Variant scripts and other free text are
 * kept as written; the author confirms they hold nothing sensitive.
 */
export function sanitiseTemplateConfig<T extends Record<string, any>>(
  config: T,
  lookupOptions: OptionLookup,
  placeholder?: string
): T {
  const cloned = structuredClone(config) as Record<string, any>;
  for (const key of TOP_LEVEL_SECRETS) cloned[key] = undefined;
  if (Array.isArray(cloned.services)) {
    cloned.services = cloned.services.map((service: any) => ({
      ...service,
      credentials: {},
    }));
  }
  if (cloned.proxy && typeof cloned.proxy === 'object') {
    cloned.proxy = {
      ...cloned.proxy,
      credentials: undefined,
      url: undefined,
      publicUrl: undefined,
    };
  }
  if (Array.isArray(cloned.presets)) {
    cloned.presets = cloned.presets.map((preset: any) =>
      preset && typeof preset === 'object' && typeof preset.type === 'string'
        ? {
            ...preset,
            options: redactPresetOptions(
              preset.options,
              lookupOptions(preset.type),
              placeholder
            ),
          }
        : preset
    );
  }
  return cloned as T;
}

/** Drops `sourceUrl`, which would let an uploader swap the config after review. */
export function sanitiseTemplateMetadata<T extends Template['metadata']>(
  metadata: T
): T {
  return { ...metadata, sourceUrl: undefined };
}

export interface TemplateReviewSummary {
  presets: Array<{
    type: string;
    name?: string;
    urlOptions: Array<{
      id: string;
      value: string;
      differsFromDefault: boolean;
    }>;
  }>;
  /** False when `presets` is a template directive rather than a plain list. */
  presetsInspected: boolean;
  /** Remote markdown shown in the changelog modal; kept because it never touches the config. */
  changelogUrl?: string;
  regexPatterns: string[];
  syncedUrls: string[];
  /** Stored as written; the usual place for a swapped service key. Absent on older rows. */
  variantScripts?: Array<{ id: string; name?: string; script: string }>;
}

function variantScripts(
  config: any
): NonNullable<TemplateReviewSummary['variantScripts']> {
  if (!Array.isArray(config?.variants)) return [];
  return config.variants.flatMap((variant: any) =>
    variant && typeof variant.script === 'string'
      ? [
          {
            id: String(variant.id ?? ''),
            name: typeof variant.name === 'string' ? variant.name : undefined,
            script: variant.script,
          },
        ]
      : []
  );
}

/** What a moderator needs to see: where addons point, and what trust would whitelist. */
export function buildTemplateReviewSummary(
  template: Template,
  lookupOptions: OptionLookup
): TemplateReviewSummary {
  const config = template.config ?? {};
  const presetsInspected = Array.isArray(config.presets);
  const presets: TemplateReviewSummary['presets'] = [];
  if (presetsInspected) {
    for (const preset of config.presets as any[]) {
      if (
        !preset ||
        typeof preset !== 'object' ||
        typeof preset.type !== 'string'
      ) {
        continue;
      }
      const meta = lookupOptions(preset.type) ?? [];
      const urlOptions = meta
        .filter((opt) => opt.type === 'url')
        .flatMap((opt) => {
          const value = extractTemplateStrings(preset.options?.[opt.id]).join(
            ' | '
          );
          if (!value) return [];
          const fallback = opt.default === undefined ? '' : String(opt.default);
          return [
            { id: opt.id, value, differsFromDefault: value !== fallback },
          ];
        });
      presets.push({
        type: preset.type,
        name: extractTemplateStrings(preset.options?.name)[0],
        urlOptions,
      });
    }
  }
  const trusted = collectTrustedStrings(config);
  return {
    presets,
    presetsInspected,
    changelogUrl: template.metadata.changelogUrl,
    regexPatterns: trusted.patterns,
    syncedUrls: [...trusted.selUrls, ...trusted.regexUrls],
    variantScripts: variantScripts(config),
  };
}
