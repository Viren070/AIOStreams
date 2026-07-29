import { Option } from '@aiostreams/core';

export function redactPresetOptions(
  options: Record<string, any> | undefined,
  optionMeta: Option[] | undefined,
  placeholder?: string
): Record<string, any> {
  return Object.fromEntries(
    Object.entries(options ?? {}).flatMap(([id, value]): [string, any][] => {
      // Removed legacy Unarr field. Never export an orphaned server-wide
      // AIOSTREAMS_AUTH credential from an older saved config.
      if (id === 'proxyAuth') return [];
      const meta = optionMeta?.find((opt) => opt.id === id);
      if (meta?.type === 'password') {
        return placeholder !== undefined && value !== undefined && value !== ''
          ? [[id, placeholder]]
          : [];
      }
      if (meta?.type === 'unarr-auth') {
        if (!value || typeof value !== 'object') return [];
        const apiKey = value.apiKey;
        return [
          [
            id,
            {
              ...value,
              apiKey:
                placeholder !== undefined && apiKey ? placeholder : undefined,
            },
          ],
        ];
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
