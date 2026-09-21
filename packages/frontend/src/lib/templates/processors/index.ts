import { Template, StatusResponse, Option } from '@aiostreams/core';
import { toast } from 'sonner';
import { asConfigArray, evaluateTemplateCondition } from './conditionals';
import * as constants from '@aiostreams/core/src/utils/constants';
import {
  ALLOWED_INPUT_TYPES,
  AllowedInputType,
  ProcessedTemplate,
  TemplateInput,
} from '../types';
import { Mode } from '@/context/mode';

/** Detect if a value is a placeholder string in the template. */
export const parsePlaceholder = (
  value: any
): { isPlaceholder: boolean; required: boolean } => {
  if (typeof value !== 'string')
    return { isPlaceholder: false, required: false };

  const placeholderPatterns = [
    { pattern: /<required_template_placeholder>/i, required: true },
    { pattern: /<optional_template_placeholder>/i, required: false },
    { pattern: /<template_placeholder>/i, required: true },
  ];

  for (const { pattern, required } of placeholderPatterns) {
    if (pattern.test(value)) {
      return { isPlaceholder: true, required };
    }
  }

  return { isPlaceholder: false, required: false };
};

const inputTypeOf = (type: string | undefined): AllowedInputType =>
  type === 'password' || type === 'url' ? type : 'string';

/** Skips `services`: those input paths are read as `services.<id>.<credential>`. */
const findPlaceholders = (
  value: any,
  path: string[],
  found: Map<string, boolean>
): void => {
  if (typeof value === 'string') {
    const placeholder = parsePlaceholder(value);
    if (placeholder.isPlaceholder) {
      found.set(path.join('.'), placeholder.required);
    }
    return;
  }
  if (!value || typeof value !== 'object') return;
  // Paths inside a directive only exist once it resolves.
  if ('__switch' in value || '__value' in value || '__remove' in value) return;
  for (const [key, child] of Object.entries(value)) {
    if (path.length === 0 && key === 'services') continue;
    findPlaceholders(child, [...path, key], found);
  }
};

const optionChain = (options: Option[] | undefined, ids: string[]) => {
  const chain: Option[] = [];
  let current = options;
  for (const id of ids) {
    const option = current?.find((o) => o.id === id);
    if (!option) return [];
    chain.push(option);
    current = option.subOptions as Option[] | undefined;
  }
  return chain;
};

type FieldInfo = Pick<
  TemplateInput,
  'key' | 'label' | 'description' | 'type'
> & { optionRequired?: boolean };

const describeField = (
  path: string,
  config: any,
  status: StatusResponse | null
): FieldInfo => {
  const [head, ...rest] = path.split('.');

  if (head === 'proxy' && rest.length === 1) {
    const field = rest[0];
    const proxy =
      constants.PROXY_SERVICE_DETAILS[
        config?.proxy?.id as keyof typeof constants.PROXY_SERVICE_DETAILS
      ];
    const name = proxy?.name ?? 'Proxy';
    const fields: Record<string, Omit<FieldInfo, 'key'>> = {
      url: {
        label: `${name} URL`,
        description: `The URL of your ${name} instance`,
        type: 'url',
      },
      publicUrl: {
        label: `${name} Public URL`,
        description: `The public URL of your ${name} instance (if different from URL)`,
        type: 'url',
      },
      credentials: {
        label: `${name} Credentials`,
        description: proxy?.credentialDescription,
        type: 'password',
      },
      publicIp: {
        label: `${name} Public IP`,
        description: `Public IP address of your ${name} instance`,
        type: 'string',
      },
    };
    if (fields[field]) return { key: `proxy_${field}`, ...fields[field] };
  }

  if (
    rest.length === 0 &&
    Object.hasOwn(constants.TOP_LEVEL_OPTION_DETAILS, head)
  ) {
    const detail =
      constants.TOP_LEVEL_OPTION_DETAILS[
        head as keyof typeof constants.TOP_LEVEL_OPTION_DETAILS
      ];
    return {
      key: `toplevel_${head}`,
      label: detail.name,
      description: detail.description,
      type: detail.type,
    };
  }

  if (head === 'presets' && rest[1] === 'options') {
    const preset = asConfigArray(config?.presets)[Number(rest[0])];
    const presetMeta = status?.settings?.presets?.find(
      (p: any) => p.ID === preset?.type
    );
    const ids = rest.slice(2);
    const chain = optionChain(presetMeta?.OPTIONS, ids);
    const option = chain.at(-1);
    if (preset) {
      // Every Debridio preset shares the one key.
      if (chain.length === 1 && option?.id === 'debridioApiKey') {
        return {
          key: 'debridioApiKey',
          label: option.name,
          description: option.description,
          type: 'password',
          optionRequired: option.required === true,
        };
      }
      return {
        key: `preset_${preset.instanceId}_${ids.join('_')}`,
        label: [
          preset.options?.name || preset.type,
          ...(option ? chain.map((o) => o.name || o.id) : ids),
        ].join(' - '),
        description: option?.description,
        type: inputTypeOf(option?.type),
        optionRequired: option?.required === true,
      };
    }
  }

  return { key: `path_${path}`, label: path, type: 'string' };
};

const getPath = (obj: any, path: string): any =>
  path.split('.').reduce((acc, part) => acc?.[part], obj);

/**
 * Process a template to extract all credential inputs and determine service handling.
 * Pure function – does not modify the template or call any hooks.
 */
export const processTemplate = (
  template: Template,
  status: StatusResponse | null,
  userData: any
): ProcessedTemplate => {
  const inputs: TemplateInput[] = [];
  const availableServices = Object.keys(status?.settings?.services || {});

  let services: string[] = [];
  let skipServiceSelection = false;
  let showServiceSelection = false;
  let allowSkipService = template.metadata.serviceRequired !== true;

  if (template.metadata.services === undefined) {
    showServiceSelection = true;
    services = availableServices;
  } else if (
    Array.isArray(template.metadata.services) &&
    template.metadata.services.length === 0
  ) {
    skipServiceSelection = true;
    services = [];
  } else if (Array.isArray(template.metadata.services)) {
    services = template.metadata.services.filter((s) =>
      availableServices.includes(s)
    );

    if (services.length === 1 && template.metadata.serviceRequired === true) {
      skipServiceSelection = true;
    } else if (services.length > 0) {
      showServiceSelection = true;
    } else {
      skipServiceSelection = true;
    }
  }

  const config = template.config;
  const requiredByPath = new Map<string, boolean>();
  findPlaceholders(config, [], requiredByPath);

  asConfigArray(config?.presets).forEach((preset: any, presetIndex: number) => {
    const presetMeta = status?.settings?.presets?.find(
      (p: any) => p.ID === preset?.type
    );
    presetMeta?.OPTIONS?.forEach((option: Option) => {
      const path = `presets.${presetIndex}.options.${option.id}`;
      if (
        ['string', 'password', 'url'].includes(option.type) &&
        option.required &&
        !preset.options?.[option.id] &&
        !requiredByPath.has(path)
      ) {
        requiredByPath.set(path, true);
      }
    });
  });

  // The server falls back to these at call time, so an empty value is fine.
  const instanceProvided: Record<string, boolean | undefined> = {
    tmdbApiKey: !!status?.settings?.metadata?.tmdb?.apiKey,
    tmdbAccessToken: !!status?.settings?.metadata?.tmdb?.accessToken,
    tvdbApiKey: !!status?.settings?.metadata?.tvdb?.apiKey,
    pmdbApiKey: status?.settings?.jellyfin?.segments.providers.some(
      (p) => p.id === 'pmdb' && p.key === 'instance'
    ),
  };

  requiredByPath.forEach((placeholderRequired, path) => {
    const { optionRequired, ...field } = describeField(path, config, status);
    const provided = instanceProvided[path] === true;
    const required = (placeholderRequired || !!optionRequired) && !provided;

    const existing = inputs.find((input) => input.key === field.key);
    if (existing) {
      existing.path = [existing.path, path].flat();
      existing.required ||= required;
      return;
    }

    const current = getPath(userData, path);
    inputs.push({
      ...field,
      description: provided
        ? [
            field.description,
            'This instance provides a default. Leave blank to use it, or enter your own to override.',
          ]
            .filter(Boolean)
            .join(' ')
        : field.description,
      path,
      required,
      value:
        typeof current === 'string' && !parsePlaceholder(current).isPlaceholder
          ? current
          : '',
    });
  });

  return {
    template,
    services,
    skipServiceSelection,
    showServiceSelection,
    allowSkipService,
    inputs,
  };
};

/** Build credential inputs for the selected services. */
export const addServiceInputs = (
  processed: ProcessedTemplate,
  selectedServiceIds: string[],
  status: StatusResponse | null,
  userData: any
): TemplateInput[] => {
  const serviceInputs: TemplateInput[] = [];

  selectedServiceIds.forEach((serviceId) => {
    const serviceMeta =
      status?.settings?.services?.[
        serviceId as keyof typeof status.settings.services
      ];
    if (!serviceMeta?.credentials) return;

    serviceMeta.credentials
      .filter((cred): cred is Option & { type: AllowedInputType } =>
        ALLOWED_INPUT_TYPES.includes(cred.type as any)
      )
      .forEach((cred) => {
        serviceInputs.push({
          key: `service_${serviceId}_${cred.id}`,
          path: `services.${serviceId}.${cred.id}`,
          label: `${serviceMeta.name} - ${cred.name || cred.id}`,
          description: cred.description,
          type: cred.type,
          required: cred.required ?? true,
          value:
            userData?.services?.find((s: any) => s.id === serviceId)
              ?.credentials?.[cred.id] || '',
        });
      });
  });

  return serviceInputs;
};

/**
 * Remove presets from `config` that are unavailable or disabled on this instance.
 * Calls `toast.warning` if any are removed.
 * Mutates config.presets in place.
 */
export const filterUnavailablePresets = (
  config: any,
  status: StatusResponse | null
): void => {
  if (!Array.isArray(config.presets)) return;
  const availablePresetIds = new Set(
    (status?.settings?.presets || [])
      .filter((p: any) => !p.DISABLED?.disabled)
      .map((p: any) => p.ID as string)
  );
  const removed = config.presets.filter(
    (preset: any) => !availablePresetIds.has(preset.type)
  );
  if (removed.length > 0) {
    toast.warning(
      `Removed ${removed.length} preset${removed.length !== 1 ? 's' : ''} not available on this instance: ${removed.map((p: any) => p.type).join(', ')}`,
      { duration: 5000 }
    );
    config.presets = config.presets.filter((preset: any) =>
      availablePresetIds.has(preset.type)
    );
  }
};

/** Deep-set a value in an object by dot-notation path. */
export const applyInputValue = (obj: any, path: string, value: any): void => {
  const parts = path.split('.');
  let current = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    const nextPart = parts[i + 1];
    const isArrayIndex = /^\d+$/.test(nextPart);

    if (!(part in current)) {
      current[part] = isArrayIndex ? [] : {};
    }
    current = current[part];
  }

  current[parts[parts.length - 1]] = value;
};

/**
 * Returns the subset of template input options that should be shown to the user,
 * respecting the current mode (noob hides advanced options) and __if conditions.
 */
export const getVisibleOptions = (
  mode: Mode,
  options: Option[],
  values: Record<string, any>,
  selectedServices: string[]
): Option[] =>
  options.reduce<Option[]>((acc, opt) => {
    if (
      mode === 'noob' &&
      (opt.advanced === true || opt.showInSimpleMode === false)
    ) {
      return acc;
    }

    if (opt.__if && typeof opt.__if === 'string') {
      const visible = evaluateTemplateCondition(
        opt.__if,
        values,
        selectedServices
      );
      if (!visible) {
        return acc;
      }
    }

    const cloned: Option = { ...opt };

    if (opt.subOptions) {
      cloned.subOptions = getVisibleOptions(
        mode,
        opt.subOptions as Option[],
        values,
        selectedServices
      );
    }

    acc.push(cloned);
    return acc;
  }, []);

/**
 * Drop persisted input values that the template's current options no longer
 * accept: ids that no longer exist, and select values that are no longer
 * offered.
 */
export const pruneStaleInputValues = (
  options: Option[],
  saved: Record<string, any>
): Record<string, any> => {
  const byId = new Map((options ?? []).map((opt) => [opt.id, opt]));
  const isOffered = (opt: Option, value: any) =>
    (opt.options ?? []).some((o) => String(o.value) === String(value));
  const result: Record<string, any> = {};

  for (const [key, value] of Object.entries(saved ?? {})) {
    const opt = byId.get(key);
    if (!opt) continue;

    if (opt.type === 'subsection') {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        result[key] = pruneStaleInputValues(
          (opt.subOptions as Option[]) ?? [],
          value
        );
      }
      continue;
    }

    // 'select-with-custom' accepts values outside its option list
    if (opt.options?.length && opt.type === 'select') {
      if (!isOffered(opt, value)) continue;
    } else if (opt.options?.length && opt.type === 'multi-select') {
      if (Array.isArray(value)) {
        const kept = value.filter((v) => isOffered(opt, v));
        // every entry went stale: fall back to the option's default
        if (kept.length === 0 && value.length > 0) continue;
        result[key] = kept;
        continue;
      }
    }

    result[key] = value;
  }

  return result;
};
