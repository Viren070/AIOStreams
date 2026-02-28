import { Template, StatusResponse } from '@aiostreams/core';
import { toast } from 'sonner';
import { asConfigArray } from './conditionals';
import * as constants from '@aiostreams/core/src/utils/constants';
import { ProcessedTemplate, TemplateInput } from '../types';

/** Detect if a value is a placeholder string in the template. */
export const parsePlaceholder = (
  value: any
): { isPlaceholder: boolean; required: boolean } => {
  if (typeof value !== 'string')
    return { isPlaceholder: false, required: false };

  const placeholderPatterns = [
    { pattern: /<required_template_placeholder>/gi, required: true },
    { pattern: /<optional_template_placeholder>/gi, required: false },
    { pattern: /<template_placeholder>/gi, required: true },
  ];

  for (const { pattern, required } of placeholderPatterns) {
    if (pattern.test(value)) {
      return { isPlaceholder: true, required };
    }
  }

  return { isPlaceholder: false, required: false };
};

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

  // Parse proxy fields
  if (template.config?.proxy && template.config.proxy.id) {
    const id = template.config.proxy
      .id as keyof typeof constants.PROXY_SERVICE_DETAILS;
    const proxyDetails = constants.PROXY_SERVICE_DETAILS[id];
    const proxyFields = [
      'url',
      'publicUrl',
      'credentials',
      'publicIp',
    ] as const;

    proxyFields.forEach((field) => {
      const value = template.config.proxy?.[field];
      const placeholder = parsePlaceholder(value);

      if (placeholder.isPlaceholder) {
        const fieldLabels: Record<string, string> = {
          url: `${proxyDetails.name} URL`,
          publicUrl: `${proxyDetails.name} Public URL`,
          credentials: `${proxyDetails.name} Credentials`,
          publicIp: `${proxyDetails.name} Public IP`,
        };

        const fieldDescriptions: Record<string, string> = {
          url: `The URL of your ${proxyDetails.name} instance`,
          publicUrl: `The public URL of your ${proxyDetails.name} instance (if different from URL)`,
          credentials: proxyDetails.credentialDescription,
          publicIp: `Public IP address of your ${proxyDetails.name} instance`,
        };

        inputs.push({
          key: `proxy_${field}`,
          path: `proxy.${field}`,
          label: fieldLabels[field] || field,
          description: fieldDescriptions[field],
          type: field === 'credentials' ? 'password' : 'string',
          required: placeholder.required,
          value: userData?.proxy?.[field] || '',
        });
      }
    });
  }

  // Parse top-level API keys
  const topLevelFields = [
    'tmdbApiKey',
    'tmdbAccessToken',
    'tvdbApiKey',
    'rpdbApiKey',
    'topPosterApiKey',
    'aioratingsApiKey',
    'aioratingsProfileId',
  ] as const;

  topLevelFields.forEach((field) => {
    const value = template.config?.[field];
    const placeholder = parsePlaceholder(value);

    if (placeholder.isPlaceholder) {
      const detail = constants.TOP_LEVEL_OPTION_DETAILS?.[field];
      inputs.push({
        key: `toplevel_${field}`,
        path: field,
        label: detail?.name || field,
        description: detail?.description,
        type: 'password',
        required: placeholder.required,
        value: userData?.[field] || '',
      });
    }
  });

  // Parse preset options
  asConfigArray(template.config?.presets).forEach(
    (preset: any, presetIndex: number) => {
      const presetMeta = status?.settings?.presets?.find(
        (p: any) => p.ID === preset.type
      );

      if (!presetMeta) return;

      presetMeta.OPTIONS?.forEach((option: any) => {
        if (option.type === 'string' || option.type === 'password') {
          const currentValue = preset.options?.[option.id];
          const placeholder = parsePlaceholder(currentValue);

          if (placeholder.isPlaceholder || (option.required && !currentValue)) {
            if (option.id === 'debridioApiKey') {
              const debridioApiKeyInput = inputs.find(
                (input) => input.key === 'debridioApiKey'
              );
              if (debridioApiKeyInput) {
                if (Array.isArray(debridioApiKeyInput.path)) {
                  debridioApiKeyInput.path.push(
                    `presets.${presetIndex}.options.${option.id}`
                  );
                } else {
                  debridioApiKeyInput.path = [
                    debridioApiKeyInput.path,
                    `presets.${presetIndex}.options.${option.id}`,
                  ];
                }
              } else {
                inputs.push({
                  key: 'debridioApiKey',
                  path: `presets.${presetIndex}.options.${option.id}`,
                  label: 'Debridio API Key',
                  description: option.description,
                  type: 'password',
                  required: true,
                  value:
                    userData?.presets?.[presetIndex]?.options?.[option.id] ||
                    '',
                });
              }
            } else {
              inputs.push({
                key: `preset_${preset.instanceId}_${option.id}`,
                path: `presets.${presetIndex}.options.${option.id}`,
                label: `${preset.options?.name || preset.type} - ${option.name || option.id}`,
                description: option.description,
                type: option.type === 'password' ? 'password' : 'string',
                required: placeholder.required || option.required || false,
                value:
                  userData?.presets?.[presetIndex]?.options?.[option.id] || '',
              });
            }
          }
        }
      });
    }
  );

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
      .filter((cred) => cred.type == 'string' || cred.type == 'password')
      .forEach((cred) => {
        serviceInputs.push({
          key: `service_${serviceId}_${cred.id}`,
          path: `services.${serviceId}.${cred.id}`,
          label: `${serviceMeta.name} - ${cred.name || cred.id}`,
          description: cred.description,
          type: 'password',
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
