import { z } from 'zod';
import { toast } from 'sonner';
import { Template } from '@aiostreams/core';
import { TemplateSchema } from './types';

export const getLocalStorageTemplates = (): Template[] => {
  try {
    const stored = localStorage.getItem('aiostreams-custom-templates');
    if (stored) {
      const parsed = z.array(TemplateSchema).parse(JSON.parse(stored));
      return parsed.map((template) => ({
        ...template,
        metadata: {
          ...template.metadata,
          source: 'external' as const,
        },
      }));
    }
  } catch (error) {
    console.error('Error loading templates from localStorage:', error);
  }
  return [];
};

export const saveLocalStorageTemplates = (templates: Template[]): void => {
  try {
    localStorage.setItem(
      'aiostreams-custom-templates',
      JSON.stringify(templates)
    );
  } catch (error) {
    console.error('Error saving templates to localStorage:', error);
    toast.error('Failed to save templates to local storage');
  }
};

export const getLocalStorageTemplateInputs = (
  templateId: string
): Record<string, any> => {
  try {
    const stored = localStorage.getItem('aiostreams-template-inputs');
    if (stored) {
      const all = JSON.parse(stored);
      return all[templateId] ?? {};
    }
  } catch {}
  return {};
};

export const saveLocalStorageTemplateInputs = (
  templateId: string,
  values: Record<string, any>
): void => {
  try {
    const stored = localStorage.getItem('aiostreams-template-inputs');
    const all = stored ? JSON.parse(stored) : {};
    all[templateId] = values;
    localStorage.setItem('aiostreams-template-inputs', JSON.stringify(all));
  } catch {}
};

/** Compare semver strings. Returns 1 if v1 > v2, -1 if v1 < v2, 0 if equal. */
export const compareVersions = (v1: string, v2: string): number => {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);

  for (let i = 0; i < 3; i++) {
    const num1 = parts1[i] || 0;
    const num2 = parts2[i] || 0;
    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }

  return 0;
};

/**
 * The template's config as applied, stored so a later update can be merged
 * against what the user started from instead of overwriting it.
 *
 * Takes only the template's own config. The user's inputs — which include
 * service credentials — are stamped into the config after this point, so a
 * snapshot that had access to them could write API keys into userData a second
 * time. Keeping them out of this signature is what makes that impossible rather
 * than merely avoided.
 */
export function templateSnapshot(config: unknown): Record<string, unknown> {
  const snapshot = JSON.parse(JSON.stringify(config ?? {}));
  // Emptied rather than trusted. The snapshot is taken before the user's inputs
  // are stamped in, so there is nothing to strip today; doing it anyway means a
  // future call moved a few lines later cannot write credentials into userData.
  // A merge has no use for them either: they are the user's, and an update must
  // never overwrite them.
  for (const service of (snapshot?.services ?? []) as any[]) {
    if (service && typeof service === 'object') service.credentials = {};
  }
  return snapshot;
}
