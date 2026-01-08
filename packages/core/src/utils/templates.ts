import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDataFolder } from './general.js';
import { Template, TemplateSchema } from '../db/schemas.js';
import { ZodError } from 'zod';
import { formatZodError, applyMigrations } from './config.js';
import { FeatureControl } from './feature.js';
import { createLogger } from './logger.js';

const logger = createLogger('templates');

// Get __dirname equivalent in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RESOURCE_DIR = path.join(__dirname, '../../../../', 'resources');

export class TemplateManager {
  private static templates: Template[] = [];

  static getTemplates(): Template[] {
    return TemplateManager.templates;
  }

  static loadTemplates(): void {
    const builtinTemplatePath = path.join(RESOURCE_DIR, 'templates');
    const customTemplatesPath = path.join(getDataFolder(), 'templates');

    //  load all builtin templates first, then custom templates
    const builtinTemplates = this.loadTemplatesFromPath(
      builtinTemplatePath,
      'builtin'
    );
    const customTemplates = this.loadTemplatesFromPath(
      customTemplatesPath,
      'custom'
    );
    // Order: custom first, then builtin (external templates added by frontend in the right order)
    this.templates = [
      ...customTemplates.templates,
      ...builtinTemplates.templates,
    ];
    const patternsInTemplates = this.templates.flatMap((template) => {
      return [
        ...(template.config.excludedRegexPatterns || []),
        ...(template.config.includedRegexPatterns || []),
        ...(template.config.requiredRegexPatterns || []),
        ...(template.config.preferredRegexPatterns || []).map(
          (pattern) => pattern.pattern
        ),
      ];
    });
    const errors = [...builtinTemplates.errors, ...customTemplates.errors];
    logger.info(
      `Loaded ${this.templates.length} templates from ${builtinTemplates.detected + customTemplates.detected} detected templates. ${patternsInTemplates.length} regex patterns detected. ${errors.length} errors occurred.`
    );
    if (patternsInTemplates.length > 0) {
      FeatureControl._addPatterns(patternsInTemplates);
    }
    if (errors.length > 0) {
      logger.error(
        `Errors loading templates: \n${errors.map((error) => `  ${error.file} - ${error.error}`).join('\n')}`
      );
    }
  }

  private static loadTemplatesFromPath(
    dirPath: string,
    source: 'builtin' | 'custom'
  ): {
    templates: Template[];
    detected: number;
    loaded: number;
    errors: { file: string; error: string }[];
  } {
    if (!fs.existsSync(dirPath)) {
      return { templates: [], detected: 0, loaded: 0, errors: [] };
    }
    const errors: { file: string; error: string }[] = [];
    const templates = fs.readdirSync(dirPath);
    const templateList: Template[] = [];
    for (const file of templates) {
      const filePath = path.join(dirPath, file);
      try {
        if (file.endsWith('.json')) {
          const rawTemplate = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          // Apply migrations to the config before parsing
          if (rawTemplate.config) {
            rawTemplate.config = applyMigrations(rawTemplate.config);
          }
          const template = TemplateSchema.parse(rawTemplate);
          templateList.push({
            ...template,
            metadata: {
              ...template.metadata,
              source,
            },
          });
        }
      } catch (error) {
        errors.push({
          file: file,
          error:
            error instanceof ZodError
              ? `Failed to parse template:\n${formatZodError(error)
                  .split('\n')
                  .map((line) => '    ' + line)
                  .join('\n')}`
              : `Failed to load template: ${error}`,
        });
      }
    }
    return {
      templates: templateList,
      detected: templates.length,
      loaded: templateList.length,
      errors,
    };
  }
}
