import { z } from 'zod';
import type { RuntimeConfigSection } from '../types.js';

const nullableString = z.string().nullable();

/**
 * Addon identity + frontend customization.
 */
export const brandingSchema = {
  addonName: {
    schema: z.string(),
    default: 'AIOStreams',
    label: 'Addon name',
    description: 'Display name shown in the manifest and UI.',
    env: 'ADDON_NAME',
    requiresRestart: false,
    secret: false,
  },
  addonId: {
    schema: z.string(),
    default: 'com.aiostreams.viren070',
    label: 'Addon ID',
    description: 'Reverse-DNS identifier published in the manifest.',
    env: 'ADDON_ID',
    requiresRestart: true,
    secret: false,
  },
  customHtml: {
    schema: nullableString,
    default: null,
    label: 'Custom HTML',
    description: 'Optional HTML injected into the configuration page.',
    env: 'CUSTOM_HTML',
    requiresRestart: false,
    secret: false,
    ui: { multiline: true },
  },
  alternateDesign: {
    schema: z.boolean(),
    default: false,
    label: 'Alternate design',
    description:
      'Switches the frontend to the alternate design (different logo and theme).',
    env: 'ALTERNATE_DESIGN',
    requiresRestart: false,
    secret: false,
  },
} as const satisfies RuntimeConfigSection;
