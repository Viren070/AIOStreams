import { Template, StatusResponse } from '@aiostreams/core';
import { asConfigArray } from './processors/conditionals';
import { TemplateSchema, TemplateValidation, formatZodError } from './types';

const VALID_INPUT_TYPES = new Set([
  'string',
  'password',
  'number',
  'boolean',
  'select',
  'select-with-custom',
  'multi-select',
  'url',
  'alert',
  'socials',
  'oauth',
  'subsection',
  'custom-nntp-servers',
]);

const VALID_SOCIAL_IDS = new Set([
  'website',
  'github',
  'discord',
  'ko-fi',
  'patreon',
  'buymeacoffee',
  'github-sponsors',
  'donate',
]);

const VALID_ALERT_INTENTS = new Set([
  'alert',
  'info',
  'success',
  'warning',
  'info-basic',
  'success-basic',
  'warning-basic',
  'alert-basic',
]);

const UNREFERENCED_EXEMPT_TYPES = new Set([
  'alert',
  'socials',
  'subsection',
  'custom-nntp-servers',
]);

/**
 * Validate a template against the schema and instance capabilities.
 * Pure function – no side effects, no state, no toasts.
 * Note: may mutate `template.config.presets` to remove unavailable presets.
 */
export function validateTemplate(
  template: Template,
  statusData: StatusResponse | null
): TemplateValidation {
  const warnings: string[] = [];
  const errors: string[] = [];

  if (!template.config) {
    errors.push('Template is missing configuration data');
    return { isValid: false, warnings, errors };
  }

  const validate = TemplateSchema.safeParse(template);
  if (!validate.success) {
    errors.push(formatZodError(validate.error));
    return { isValid: false, warnings, errors };
  }

  // Check if addons exist on instance
  const presetsArray = asConfigArray(template.config.presets);
  if (presetsArray.length > 0 && statusData) {
    const presetsToRemove: string[] = [];
    presetsArray.forEach((preset: any) => {
      const presetMeta = statusData.settings?.presets?.find(
        (p) => p.ID === preset.type
      );
      if (!presetMeta || presetMeta.DISABLED?.disabled) {
        warnings.push(
          `"${preset.type}" is not available or disabled on this instance.`
        );
        presetsToRemove.push(preset.type);
      }
    });
    if (Array.isArray(template.config.presets) && presetsToRemove.length > 0) {
      template.config.presets = template.config.presets.filter(
        (p: any) => !presetsToRemove.includes(p.type)
      );
    }
  }

  // Check if services exist on instance
  if (statusData) {
    const availableServices = Object.keys(statusData.settings?.services || {});
    asConfigArray(template.config.services).forEach((service: any) => {
      if (!availableServices.includes(service.id)) {
        warnings.push(`Service "${service.id}" not available on this instance`);
      }
    });

    // Check regex patterns
    const excludedRegexes = asConfigArray(
      template.config.excludedRegexPatterns
    );
    const includedRegexes = asConfigArray(
      template.config.includedRegexPatterns
    );
    const requiredRegexes = asConfigArray(
      template.config.requiredRegexPatterns
    );
    const preferredRegexes = asConfigArray(
      template.config.preferredRegexPatterns
    ).map((r: any) => (typeof r === 'string' ? r : r.pattern));

    const allRegexes = [
      ...excludedRegexes,
      ...includedRegexes,
      ...requiredRegexes,
      ...preferredRegexes,
    ];

    if (allRegexes.length > 0) {
      const allowedPatterns = statusData.settings?.regexAccess?.patterns || [];

      if (
        statusData.settings?.regexAccess?.level === 'none' &&
        allowedPatterns.length === 0
      ) {
        warnings.push(
          'Template uses regex patterns but regex access is disabled on this instance'
        );
      } else if (statusData.settings?.regexAccess?.level !== 'all') {
        const unsupportedPatterns = allRegexes.filter(
          (pattern) => !allowedPatterns.includes(pattern)
        );
        if (unsupportedPatterns.length > 0) {
          warnings.push(
            `Template has ${unsupportedPatterns.length} regex patterns that are not trusted.`
          );
        }
      }
    }
  }

  // Validate dynamic expressions (__if, __switch, {{...}})
  const declaredInputIds = new Set(
    ((template.metadata as any).inputs ?? []).map((i: any) => i.id as string)
  );
  const usedInputIds = new Set<string>();

  const validateExpressions = (node: any, path: string) => {
    if (!node || typeof node !== 'object') {
      if (typeof node === 'string') {
        const tokens = [
          ...node.matchAll(/\{\{(inputs|services)\.([^}]+)\}\}/g),
        ];
        for (const [, ns, key] of tokens) {
          if (ns === 'inputs') {
            const topKey = key.split('.')[0];
            usedInputIds.add(topKey);
            if (key.includes('.')) {
              usedInputIds.add(key.split('.').slice(0, 2).join('.'));
            }
            if (!declaredInputIds.has(topKey)) {
              warnings.push(
                `${path}: interpolation {{inputs.${key}}} references undeclared input "${topKey}"`
              );
            }
          }
        }
      }
      return;
    }

    if (Array.isArray(node)) {
      node.forEach((item, i) => validateExpressions(item, `${path}[${i}]`));
      return;
    }

    if ('__if' in node) {
      const condition: string = node.__if;
      if (typeof condition !== 'string' || !condition.trim()) {
        errors.push(`${path}.__if: condition must be a non-empty string`);
      } else {
        const subConditions = condition.trim().split(/ and | or | xor /);
        for (const subCond of subConditions) {
          const bare = subCond.trim().replace(/^!/, '').split(/\s+/)[0];
          const dotIdx = bare.indexOf('.');
          if (dotIdx === -1) {
            if (bare !== 'services') {
              errors.push(
                `${path}.__if: "${subCond.trim()}" is not a valid condition - expected "inputs\.<id>" or "services\.<id> or "services"`
              );
            }
          } else {
            const ns = bare.slice(0, dotIdx === -1 ? undefined : dotIdx);
            const key = bare.slice(dotIdx + 1);
            const topKey = key.split('.')[0];
            if (ns !== 'inputs' && ns !== 'services') {
              errors.push(
                `${path}.__if: unknown namespace "${ns}" - must be "inputs" or "services"`
              );
            } else if (ns === 'inputs') {
              usedInputIds.add(topKey);
              if (key.includes('.')) {
                usedInputIds.add(key.split('.').slice(0, 2).join('.'));
              }
              if (!declaredInputIds.has(topKey)) {
                warnings.push(
                  `${path}.__if: references undeclared input "${topKey}"`
                );
              }
            }
          }
        }
      }
      const { __if: _if, ...rest } = node;
      validateExpressions(rest, path);
      return;
    }

    if ('__switch' in node) {
      const ref: string = node.__switch;
      if (typeof ref !== 'string' || !ref.trim()) {
        errors.push(`${path}.__switch: value must be a non-empty string`);
      } else {
        const dotIdx = ref.indexOf('.');
        if (dotIdx === -1) {
          if (ref.trim() !== 'services') {
            errors.push(
              `${path}.__switch: "${ref}" is not a valid reference - expected "inputs\.<id>" or "services\.<id> or "services"`
            );
          }
        } else {
          const ns = ref.slice(0, dotIdx);
          const key = ref.slice(dotIdx + 1);
          const topKey = key.split('.')[0];
          if (ns !== 'inputs' && ns !== 'services') {
            errors.push(
              `${path}.__switch: unknown namespace "${ns}" - must be "inputs" or "services"`
            );
          } else if (ns === 'inputs') {
            usedInputIds.add(topKey);
            if (key.includes('.')) {
              usedInputIds.add(key.split('.').slice(0, 2).join('.'));
            }
            if (!declaredInputIds.has(topKey)) {
              warnings.push(
                `${path}.__switch: references undeclared input "${topKey}"`
              );
            }
          }
        }
      }
      if (node.cases && typeof node.cases === 'object') {
        for (const [caseKey, caseVal] of Object.entries(node.cases)) {
          validateExpressions(caseVal, `${path}.__switch.cases.${caseKey}`);
        }
      } else if (!('cases' in node)) {
        warnings.push(
          `${path}.__switch: missing "cases" object - switch will always resolve to default`
        );
      }
      if ('default' in node) {
        validateExpressions(node.default, `${path}.__switch.default`);
      }
      return;
    }

    if ('__value' in node) {
      validateExpressions(node.__value, `${path}.__value`);
      return;
    }

    if ('__remove' in node) {
      return;
    }

    for (const [k, v] of Object.entries(node)) {
      validateExpressions(v, `${path}.${k}`);
    }
  };

  const validateInputs = (
    inputs: any,
    parentPath = 'metadata.inputs',
    allIds = new Set<string>()
  ) => {
    if (!Array.isArray(inputs)) {
      errors.push(`${parentPath} must be an array`);
      return;
    }
    inputs.forEach((input: any, idx: number) => {
      const basePath = `${parentPath}[${idx}]`;
      if (typeof input !== 'object' || input === null) {
        errors.push(`${basePath}: must be an object`);
        return;
      }

      if (typeof input.id !== 'string' || !input.id.trim()) {
        errors.push(`${basePath}.id: must be a non-empty string`);
      } else if (allIds.has(input.id)) {
        errors.push(`${basePath}.id: duplicate input id "${input.id}"`);
      } else {
        allIds.add(input.id);
      }

      if (!input.type || !VALID_INPUT_TYPES.has(input.type)) {
        errors.push(
          `${basePath}.type: "${input.type}" is not a valid input type`
        );
        return;
      }

      const nameAllowEmpty = input.type === 'socials' || input.type === 'alert';
      if (!nameAllowEmpty) {
        if (typeof input.name !== 'string' || !input.name.trim()) {
          errors.push(`${basePath}.name: must be a non-empty string`);
        }
      } else if (input.name !== undefined && typeof input.name !== 'string') {
        errors.push(`${basePath}.name: must be a string`);
      }

      switch (input.type as string) {
        case 'select':
        case 'select-with-custom':
        case 'multi-select': {
          if (
            input.default !== undefined &&
            (input.type !== 'multi-select'
              ? typeof input.default !== 'string' || !input.default.trim()
              : typeof input.default !== 'object' ||
                !Array.isArray(input.default))
          ) {
            errors.push(
              `${basePath}.default: must be a ${input.type === 'multi-select' ? 'array' : 'non-empty string'}`
            );
          }
          if (!Array.isArray(input.options) || input.options.length === 0) {
            errors.push(
              `${basePath}.options: "${input.type}" requires a non-empty options array`
            );
          } else {
            const seenValues = new Set();
            input.options.forEach((opt: any, oidx: number) => {
              const oPath = `${basePath}.options[${oidx}]`;
              if (typeof opt !== 'object' || opt === null) {
                errors.push(
                  `${oPath}: must be an object with "label" and "value"`
                );
                return;
              }
              if (typeof opt.label !== 'string' || !opt.label.trim()) {
                errors.push(`${oPath}.label: must be a non-empty string`);
              }
              if (
                opt.value === undefined ||
                opt.value === null ||
                opt.value === '' ||
                typeof opt.value !== 'string'
              ) {
                errors.push(`${oPath}.value: must be a non-empty string`);
              } else if (seenValues.has(opt.value)) {
                warnings.push(
                  `${oPath}.value: duplicate option value "${opt.value}"`
                );
              } else {
                seenValues.add(opt.value);
              }
            });
          }
          break;
        }
        case 'socials': {
          if (!Array.isArray(input.socials) || input.socials.length === 0) {
            errors.push(
              `${basePath}.socials: "socials" type requires a non-empty socials array`
            );
          } else {
            input.socials.forEach((social: any, sidx: number) => {
              const sPath = `${basePath}.socials[${sidx}]`;
              if (!VALID_SOCIAL_IDS.has(social.id)) {
                errors.push(
                  `${sPath}.id: "${social.id}" is not a valid social id`
                );
              }
              if (typeof social.url !== 'string' || !social.url.trim()) {
                errors.push(`${sPath}.url: must be a non-empty string`);
              } else {
                try {
                  new URL(social.url);
                } catch {
                  errors.push(
                    `${sPath}.url: "${social.url}" is not a valid URL`
                  );
                }
              }
            });
          }
          break;
        }
        case 'alert': {
          if (input.intent && !VALID_ALERT_INTENTS.has(input.intent)) {
            warnings.push(
              `${basePath}.intent: "${input.intent}" is not a recognised alert intent`
            );
          }
          break;
        }
        case 'oauth': {
          if (!input.oauth || typeof input.oauth !== 'object') {
            errors.push(
              `${basePath}.oauth: "oauth" type requires an oauth config object`
            );
          } else {
            if (
              typeof input.oauth.authorisationUrl !== 'string' ||
              !input.oauth.authorisationUrl.trim()
            ) {
              errors.push(
                `${basePath}.oauth.authorisationUrl: must be a non-empty string`
              );
            } else {
              try {
                new URL(input.oauth.authorisationUrl);
              } catch {
                errors.push(
                  `${basePath}.oauth.authorisationUrl: not a valid URL`
                );
              }
            }
            if (
              !input.oauth.oauthResultField ||
              typeof input.oauth.oauthResultField !== 'object'
            ) {
              errors.push(
                `${basePath}.oauth.oauthResultField: must be an object`
              );
            } else {
              if (
                typeof input.oauth.oauthResultField.name !== 'string' ||
                !input.oauth.oauthResultField.name.trim()
              ) {
                errors.push(
                  `${basePath}.oauth.oauthResultField.name: must be a non-empty string`
                );
              }
              if (
                typeof input.oauth.oauthResultField.description !== 'string' ||
                !input.oauth.oauthResultField.description.trim()
              ) {
                errors.push(
                  `${basePath}.oauth.oauthResultField.description: must be a non-empty string`
                );
              }
            }
          }
          break;
        }
        case 'subsection': {
          if (!Array.isArray(input.subOptions)) {
            errors.push(
              `${basePath}.subOptions: "subsection" type requires a subOptions array`
            );
          } else {
            validateInputs(
              input.subOptions,
              `${basePath}.subOptions`,
              new Set<string>()
            );
          }
          break;
        }
        case 'string':
        case 'password':
        case 'url': {
          if (
            input.default !== undefined &&
            (typeof input.default !== 'string' || !input.default.trim())
          ) {
            errors.push(
              `${basePath}.default: must be a non-empty string for "${input.type}" type`
            );
          }
          break;
        }
        case 'number': {
          if (
            input.default !== undefined &&
            typeof input.default !== 'number'
          ) {
            warnings.push(
              `${basePath}.default: expected a number for "number" type, got ${typeof input.default}`
            );
          }
          if (input.constraints) {
            const { min, max } = input.constraints;
            if (min !== undefined && typeof min !== 'number') {
              errors.push(`${basePath}.constraints.min: must be a number`);
            }
            if (max !== undefined && typeof max !== 'number') {
              errors.push(`${basePath}.constraints.max: must be a number`);
            }
            if (
              typeof min === 'number' &&
              typeof max === 'number' &&
              min > max
            ) {
              errors.push(
                `${basePath}.constraints: min (${min}) cannot exceed max (${max})`
              );
            }
          }
          break;
        }
      }

      if (
        input.forced !== undefined &&
        input.forced !== null &&
        input.required === true
      ) {
        warnings.push(
          `${basePath}: both "forced" and "required" are set - "required" has no effect when a value is forced`
        );
      }
    });
  };

  if (template.config) {
    validateExpressions(template.config, 'config');
  }

  if (template.metadata.inputs) {
    validateInputs(template.metadata.inputs);
  }

  // Warn about declared inputs that are never referenced in config.
  if (template.metadata.inputs) {
    (template.metadata.inputs as any[]).forEach((input: any) => {
      if (
        input.id &&
        typeof input.type === 'string' &&
        !UNREFERENCED_EXEMPT_TYPES.has(input.type) &&
        !usedInputIds.has(input.id)
      ) {
        warnings.push(
          `metadata.inputs: "${input.id}" (${input.type}) is declared but never referenced in config`
        );
      }
      if (input.type === 'subsection' && Array.isArray(input.subOptions)) {
        (input.subOptions as any[]).forEach((sub: any) => {
          if (
            sub.id &&
            typeof sub.type === 'string' &&
            !UNREFERENCED_EXEMPT_TYPES.has(sub.type) &&
            !usedInputIds.has(`${input.id}.${sub.id}`)
          ) {
            warnings.push(
              `metadata.inputs: "${input.id}.${sub.id}" (${sub.type}) is declared but never referenced in config`
            );
          }
        });
      }
    });
  }

  return { isValid: errors.length === 0, warnings, errors };
}

/**
 * Scan a raw JSON string for duplicate object keys at any nesting level.
 */
export function detectDuplicateKeys(rawJson: string): string[] {
  const warnings: string[] = [];

  const stack: Array<{ path: string; seen: Set<string> }> = [];
  const pathStack: string[] = [];

  let i = 0;
  while (i < rawJson.length) {
    const ch = rawJson[i];

    if (ch === '{') {
      const path = pathStack.join('') || 'root';
      stack.push({ path, seen: new Set() });
      i++;
      continue;
    }

    if (ch === '}') {
      stack.pop();
      i++;
      continue;
    }

    if (ch === '"' && stack.length > 0) {
      let j = i + 1;
      let key = '';
      while (j < rawJson.length) {
        if (rawJson[j] === '\\') {
          j += 2;
          continue;
        }
        if (rawJson[j] === '"') break;
        key += rawJson[j];
        j++;
      }
      j++; // skip closing quote
      // Skip whitespace
      while (j < rawJson.length && /\s/.test(rawJson[j])) j++;
      // If followed by ':', this is an object key
      if (rawJson[j] === ':') {
        const frame = stack[stack.length - 1];
        if (frame.seen.has(key)) {
          warnings.push(`${frame.path}: duplicate key "${key}"`);
        } else {
          frame.seen.add(key);
        }
        i = j + 1; // skip past ':'
        continue;
      }
    }

    i++;
  }

  return warnings;
}
