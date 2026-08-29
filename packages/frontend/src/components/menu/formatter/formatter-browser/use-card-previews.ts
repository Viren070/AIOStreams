import { useEffect, useMemo, useState } from 'react';
import type { FormatterDefinition } from '../../../../../../core/src/utils/formatter-definitions';
import { useUserData } from '@/context/userData';
import { useStatus } from '@/context/status';
import { renderFormatter } from '@/lib/formatter-render';
import { loadPreviewInput } from '../preview/state';

export interface CardPreview {
  name?: string;
  description?: string;
  error?: string;
}

/**
 * Render every definition against the current preview sample. Local and
 * async, so a large grid never touches the network.
 */
export function useCardPreviews(
  definitions: Record<string, FormatterDefinition>,
  enabled: boolean
): Record<string, CardPreview> {
  const { userData } = useUserData();
  const { status } = useStatus();
  const addonName = status?.settings.addonName;
  const [previews, setPreviews] = useState<Record<string, CardPreview>>({});

  const input = useMemo(() => loadPreviewInput(), [enabled]);

  useEffect(() => {
    if (!enabled) return;
    if (Object.keys(definitions).length === 0) {
      setPreviews((prev) => (Object.keys(prev).length === 0 ? prev : {}));
      return;
    }
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        Object.entries(definitions).map(
          async ([key, definition]): Promise<[string, CardPreview]> => {
            try {
              return [
                key,
                await renderFormatter(definition, userData, addonName, input),
              ];
            } catch (error) {
              return [
                key,
                {
                  error: error instanceof Error ? error.message : String(error),
                },
              ];
            }
          }
        )
      );
      if (!cancelled) setPreviews(Object.fromEntries(entries));
    })();
    return () => {
      cancelled = true;
    };
  }, [definitions, enabled, userData, addonName, input]);

  return previews;
}
