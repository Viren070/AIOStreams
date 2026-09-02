import { Template } from '@aiostreams/core';
import * as constants from '../../../../core/src/utils/constants';

export interface TemplateRequirements {
  /** Every addon the template can install, across all directive branches. */
  addons: string[];
  /** Display names of the services the template declares up front. */
  services: string[];
  /** The template picks its services from whatever the instance offers. */
  servicesChosenDuringSetup: boolean;
  /** An empty service list, which skips the selection step entirely. */
  skipsServiceSelection: boolean;
  /** Presets sit behind `__if`/`__switch`, so the final set depends on answers. */
  addonsVary: boolean;
}

/** A preset entry, in resolved or unresolved form. */
function isPresetLike(value: any): boolean {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof value.type === 'string' &&
    ('options' in value || 'instanceId' in value)
  );
}

function presetLabel(preset: any): string {
  const name = preset.options?.name;
  // Names can carry `{{inputs.x}}` placeholders before conditionals are applied.
  return typeof name === 'string' && !name.includes('{{') ? name : preset.type;
}

/**
 * Walk a `presets` field of any shape and collect every addon it could produce.
 * Templates that use directives (`__if`, `__switch`, `__value`) keep their
 * presets nested inside case objects, so a plain array read finds nothing.
 */
function walkPresets(value: any, into: Set<string>, depth = 0): void {
  if (!value || typeof value !== 'object' || depth > 12) return;

  if (Array.isArray(value)) {
    for (const item of value) {
      if (isPresetLike(item)) into.add(presetLabel(item));
      else walkPresets(item, into, depth + 1);
    }
    return;
  }

  if (isPresetLike(value)) {
    into.add(presetLabel(value));
    return;
  }

  for (const key of Object.keys(value)) {
    // `__if` / `__switch` hold condition strings, not config.
    if (key === '__if' || key === '__switch') continue;
    walkPresets(value[key], into, depth + 1);
  }
}

export function templateRequirements(template: Template): TemplateRequirements {
  const presets = template.config?.presets;
  const addonSet = new Set<string>();
  walkPresets(presets, addonSet);

  const declaredServices = template.metadata.services;

  return {
    addons: [...addonSet],
    services: (declaredServices ?? []).map(
      (service) =>
        constants.SERVICE_DETAILS[
          service as keyof typeof constants.SERVICE_DETAILS
        ]?.name || service
    ),
    // `processTemplate` treats an absent list as "offer everything this
    // instance has", which is a choice the user makes during setup, and an
    // empty list as "skip the selection step entirely".
    servicesChosenDuringSetup: declaredServices === undefined,
    skipsServiceSelection:
      Array.isArray(declaredServices) && declaredServices.length === 0,
    addonsVary: !!presets && !Array.isArray(presets),
  };
}
