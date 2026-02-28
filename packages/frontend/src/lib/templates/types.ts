import { z, ZodError } from 'zod';
import { Template, Option } from '@aiostreams/core';
import * as constants from '../../../../core/src/utils/constants';

export const formatZodError = (error: ZodError) => {
  console.log(JSON.stringify(error, null, 2));
  return z.prettifyError(error);
};

export const TemplateSchema = z.object({
  metadata: z.object({
    id: z
      .string()
      .min(1)
      .max(100)
      .optional()
      .transform((val) => val ?? crypto.randomUUID()),
    name: z.string().min(1).max(100),
    description: z.string().min(1).max(1000),
    author: z.string().min(1).max(20),
    source: z
      .enum(['builtin', 'custom', 'external'])
      .optional()
      .default('builtin'),
    version: z
      .stringFormat('semver', /^[0-9]+\.[0-9]+\.[0-9]+$/)
      .optional()
      .default('1.0.0'),
    category: z.string().min(1).max(20),
    services: z.array(z.enum(constants.SERVICES)).optional(),
    serviceRequired: z.boolean().optional(),
    setToSaveInstallMenu: z.boolean().optional().default(true),
    sourceUrl: z.url().optional(),
    inputs: z.array(z.any()).optional(),
  }),
  config: z.any(),
});

export interface TemplateValidation {
  isValid: boolean;
  warnings: string[];
  errors: string[];
}

export interface TemplateInput {
  key: string;
  path: string | string[];
  label: string;
  description?: string;
  type: 'string' | 'password';
  required: boolean;
  value: string;
}

export interface ProcessedTemplate {
  template: Template;
  services: string[];
  skipServiceSelection: boolean;
  showServiceSelection: boolean;
  allowSkipService: boolean;
  inputs: TemplateInput[];
}

export type WizardStep =
  | 'browse'
  | 'templateInputs'
  | 'selectService'
  | 'inputs';

/** Snapshot of all wizard state saved before each forward navigation step. */
export interface WizardSnapshot {
  step: WizardStep;
  processedTemplate: ProcessedTemplate | null;
  pendingTemplate: Template | null;
  templateInputOptions: Option[];
  templateInputValues: Record<string, any>;
  selectedServices: string[];
  inputValues: Record<string, string>;
}

export interface ConfigTemplatesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  openImportModal?: boolean;
  /** If set, the modal will automatically fetch and process this URL when it opens. */
  deepLinkUrl?: string;
  /** If set alongside deepLinkUrl, auto-selects the template with this ID from the fetched list. */
  deepLinkTemplateId?: string;
}

export const TEMPLATE_CACHE = new Map<string, Template[]>();
