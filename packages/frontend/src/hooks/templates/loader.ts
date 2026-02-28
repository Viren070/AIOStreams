'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { Template, StatusResponse } from '@aiostreams/core';
import { fetchTemplates } from '@/lib/api';
import { TemplateValidation, TEMPLATE_CACHE } from '@/lib/templates/types';
import {
  getLocalStorageTemplates,
  saveLocalStorageTemplates,
  compareVersions,
} from '@/lib/templates/storage';
import { validateTemplate } from '@/lib/templates/validator';

export interface UseTemplateLoader {
  templates: Template[];
  setTemplates: React.Dispatch<React.SetStateAction<Template[]>>;
  loadingTemplates: boolean;
  templateValidations: Record<string, TemplateValidation>;
  setTemplateValidations: React.Dispatch<React.SetStateAction<Record<string, TemplateValidation>>>;
  loadTemplates(): Promise<void>;
}

export function useTemplateLoader(
  status: StatusResponse | null
): UseTemplateLoader {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [templateValidations, setTemplateValidations] = useState<
    Record<string, TemplateValidation>
  >({});

  const checkAndUpdateTemplates = async (
    templateList: Template[]
  ): Promise<Template[]> => {
    const updatedTemplates: Template[] = [];
    const templatesToUpdate: Array<{ old: Template; new: Template }> = [];

    for (const template of templateList) {
      if (!template.metadata.sourceUrl) {
        updatedTemplates.push(template);
        continue;
      }

      try {
        let fetched: Template[] = [];
        const cached = TEMPLATE_CACHE.get(template.metadata.sourceUrl);
        if (cached) {
          fetched = cached;
        } else {
          const response = await fetch(template.metadata.sourceUrl);
          if (!response.ok) {
            console.warn(
              `Failed to fetch update for template "${template.metadata.name}": ${response.status}`
            );
            updatedTemplates.push(template);
            continue;
          }
          const data = await response.json();
          fetched = Array.isArray(data) ? data : [data];
          TEMPLATE_CACHE.set(template.metadata.sourceUrl, fetched);
        }

        const remoteTemplate = fetched.find((item: any) => {
          const id = item.metadata?.id || item.id;
          return id === template.metadata.id;
        });

        if (!remoteTemplate) {
          console.warn(
            `Template "${template.metadata.name}" not found at source URL`
          );
          updatedTemplates.push(template);
          continue;
        }

        const validatedTemplate: Template = {
          metadata: {
            ...remoteTemplate.metadata,
            id: template.metadata.id,
            source: 'external' as const,
            sourceUrl: template.metadata.sourceUrl,
            setToSaveInstallMenu:
              remoteTemplate.metadata?.setToSaveInstallMenu ?? true,
            version: remoteTemplate.metadata?.version || '1.0.0',
            name: remoteTemplate.metadata?.name || template.metadata.name,
            description:
              remoteTemplate.metadata?.description ||
              template.metadata.description,
            author:
              remoteTemplate.metadata?.author || template.metadata.author,
            category:
              remoteTemplate.metadata?.category || template.metadata.category,
            services: remoteTemplate.metadata?.services,
            serviceRequired: remoteTemplate.metadata?.serviceRequired,
          },
          config: remoteTemplate.config || remoteTemplate,
        };

        const remoteVersion = validatedTemplate.metadata.version || '1.0.0';
        const localVersion = template.metadata.version || '1.0.0';

        if (compareVersions(remoteVersion, localVersion) > 0) {
          templatesToUpdate.push({ old: template, new: validatedTemplate });
          updatedTemplates.push(validatedTemplate);
          console.log(
            `Updated template "${template.metadata.name}" from v${localVersion} to v${remoteVersion}`
          );
        } else {
          updatedTemplates.push(template);
        }
      } catch (error) {
        console.error(
          `Error checking update for template "${template.metadata.name}":`,
          error
        );
        updatedTemplates.push(template);
      }
    }

    if (templatesToUpdate.length > 0) {
      const names = templatesToUpdate
        .map((t) => t.new.metadata.name)
        .join(', ');
      toast.success(
        `Updated ${templatesToUpdate.length} template${templatesToUpdate.length !== 1 ? 's' : ''}: ${names}`
      );
    }

    return updatedTemplates;
  };

  const loadTemplates = async () => {
    setLoadingTemplates(true);
    let fetchedTemplates: Template[] = [];
    try {
      const cachedTemplates = TEMPLATE_CACHE.get('api_templates');
      if (!cachedTemplates) {
        fetchedTemplates = await fetchTemplates();
        TEMPLATE_CACHE.set('api_templates', fetchedTemplates);
      } else {
        fetchedTemplates = cachedTemplates;
      }

      let localTemplates = getLocalStorageTemplates();
      const updatedLocalTemplates =
        await checkAndUpdateTemplates(localTemplates);

      if (
        JSON.stringify(updatedLocalTemplates) !== JSON.stringify(localTemplates)
      ) {
        saveLocalStorageTemplates(updatedLocalTemplates);
        localTemplates = updatedLocalTemplates;
      }

      // Filter out local templates superseded by a newer API version
      localTemplates = localTemplates.filter((template) => {
        const existing = fetchedTemplates.find(
          (t) => t.metadata.id === template.metadata.id
        );
        if (existing) {
          return (
            compareVersions(
              template.metadata.version,
              existing.metadata.version
            ) === 1
          );
        }
        return true;
      });

      // Merge, keeping external first (they take priority on duplicate IDs)
      const allTemplates = [...localTemplates, ...fetchedTemplates];
      const uniqueTemplates = allTemplates.reduce(
        (acc: Template[], template) => {
          if (!acc.some((t) => t.metadata.id === template.metadata.id)) {
            acc.push(template);
          }
          return acc;
        },
        []
      );

      setTemplates(uniqueTemplates);

      if (status) {
        const validations: Record<string, TemplateValidation> = {};
        uniqueTemplates.forEach((template: Template) => {
          validations[template.metadata.id] = validateTemplate(
            template,
            status
          );
        });
        setTemplateValidations(validations);
      }
    } catch (error) {
      console.error('Error fetching templates:', error);
      toast.error('Failed to load templates');
    } finally {
      setLoadingTemplates(false);
    }
  };

  return { templates, setTemplates, loadingTemplates, templateValidations, setTemplateValidations, loadTemplates };
}
