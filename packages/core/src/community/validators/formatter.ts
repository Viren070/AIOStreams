import { FormatterTemplateShape } from '../../db/schemas.js';
import { validateTemplate } from '../../formatters/engine/parser.js';
import type { FormatterDefinition } from '../../utils/formatter-definitions.js';
import { APIError, ErrorCode } from '../../utils/constants.js';
import { formatZodError } from '../../utils/format-zod-error.js';

// The lint categories the editor also treats as hard errors.
const HARD_ERRORS = new Set([
  'unterminated',
  'unterminated-group',
  'unparseable',
]);

export function validateCommunityFormatter(
  payload: unknown
): FormatterDefinition {
  const parsed = FormatterTemplateShape.safeParse(payload);
  if (!parsed.success) {
    throw new APIError(
      ErrorCode.COMMUNITY_INVALID_ITEM,
      undefined,
      formatZodError(parsed.error, { singleLine: true })
    );
  }
  for (const [field, template] of Object.entries(parsed.data)) {
    const error = validateTemplate(template).find((d) =>
      HARD_ERRORS.has(d.category)
    );
    if (error) {
      throw new APIError(
        ErrorCode.COMMUNITY_INVALID_ITEM,
        undefined,
        `${field} template: ${error.message}`
      );
    }
  }
  return parsed.data;
}
