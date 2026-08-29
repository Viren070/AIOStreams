import {
  TemplateSchema,
  type Option,
  type Template,
} from '../../db/schemas.js';
import { PresetManager } from '../../presets/index.js';
import { APIError, ErrorCode } from '../../utils/constants.js';
import { formatZodError } from '../../utils/format-zod-error.js';
import {
  buildTemplateReviewSummary,
  sanitiseTemplateMetadata,
  type TemplateReviewSummary,
} from '../../utils/template-sanitise.js';

function lookupOptions(type: string): Option[] | undefined {
  try {
    return PresetManager.fromId(type).METADATA.OPTIONS;
  } catch {
    return undefined;
  }
}

function invalid(message: string): never {
  throw new APIError(ErrorCode.COMMUNITY_INVALID_ITEM, undefined, message);
}

/**
 * An uploaded template is stored as sent: nothing in the config is rewritten
 * or removed.
 */
export function validateCommunityTemplate(payload: unknown): {
  payload: Template;
  reviewSummary: TemplateReviewSummary;
} {
  const parsed = TemplateSchema.safeParse(payload);
  if (!parsed.success) {
    invalid(formatZodError(parsed.error, { singleLine: true }));
  }
  const template = parsed.data;
  if (!template.config || typeof template.config !== 'object') {
    invalid('A template needs a config object');
  }
  const presets = Array.isArray(template.config.presets)
    ? template.config.presets
    : [];
  for (const preset of presets) {
    const type = preset?.type;
    if (typeof type === 'string' && !lookupOptions(type)) {
      invalid(`Unknown addon type "${type}"`);
    }
  }
  const accepted: Template = {
    metadata: sanitiseTemplateMetadata(template.metadata),
    config: template.config,
  };
  return {
    payload: accepted,
    reviewSummary: buildTemplateReviewSummary(accepted, lookupOptions),
  };
}
