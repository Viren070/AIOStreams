import type { FormatterContext, UserData } from '@aiostreams/core';
import { CustomFormatter } from '../../../core/src/formatters';
import type { FormatterDefinition } from '../../../core/src/utils/formatter-definitions';
import {
  buildFormatterContext,
  buildParsedStream,
  loadPreviewInput,
  PreviewInput,
} from '@/components/menu/formatter/preview/state';

export interface RenderedFormatter {
  name: string;
  description: string;
}

/**
 * Render a formatter definition against the preview sample entirely in the
 * browser. Mirrors the server's `/format` route: a null preview field means
 * "absent", so it must not shadow the engine's defaults.
 */
export async function renderFormatter(
  definition: FormatterDefinition,
  userData: UserData,
  addonName: string | undefined,
  input: PreviewInput = loadPreviewInput()
): Promise<RenderedFormatter> {
  const context = Object.fromEntries(
    Object.entries(buildFormatterContext(input)).map(([key, value]) => [
      key,
      value ?? undefined,
    ])
  );
  const formatter = CustomFormatter.fromConfig(definition, {
    ...context,
    userData,
    addonName,
  } as FormatterContext);
  return formatter.format(buildParsedStream(input));
}
