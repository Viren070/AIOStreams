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
