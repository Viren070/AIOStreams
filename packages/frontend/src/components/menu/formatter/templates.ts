import * as constants from '../../../../../core/src/utils/constants';
import { BUILTIN_FORMATTER_DEFINITIONS } from '../../../../../core/src/utils/formatter-definitions';
import { UserData } from '@aiostreams/core';

// Read the active name/description templates from userData — single source of truth.
export function getTemplates(data: UserData): {
  name: string;
  description: string;
} {
  const id = data.formatter.id;
  const defs = data.formatter.definitions;
  if (id === constants.CUSTOM_FORMATTER) {
    const selected = data.formatter.selectedSaved;
    const definition =
      (selected ? defs?.saved?.[selected] : undefined) ?? defs?.custom;
    return {
      name: definition?.name ?? '',
      description: definition?.description ?? '',
    };
  }
  const override = defs?.overrides?.[id];
  if (override)
    return { name: override.name, description: override.description };
  const builtin = BUILTIN_FORMATTER_DEFINITIONS[id];
  return { name: builtin?.name ?? '', description: builtin?.description ?? '' };
}

/** The saved formatter currently being edited in place, if any. */
export function getActiveSavedName(data: UserData): string | undefined {
  const selected = data.formatter.selectedSaved;
  if (
    data.formatter.id === constants.CUSTOM_FORMATTER &&
    selected &&
    data.formatter.definitions?.saved?.[selected]
  ) {
    return selected;
  }
  return undefined;
}
