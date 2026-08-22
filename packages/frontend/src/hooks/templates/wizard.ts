import { useState } from 'react';
import { toast } from 'sonner';
import {
  Template,
  Option,
  StatusResponse,
  ServiceId,
  MenuId,
} from '@aiostreams/core';
import { applyMigrations, useUserData } from '@/context/userData';
import {
  planTemplateUpdate,
  type TemplateUpdateConflict,
} from '@/lib/templates/merge';
import {
  applyTemplateConditionals,
  resolveCredentialRefs,
} from '@/lib/templates/processors/conditionals';
import {
  WizardStep,
  WizardSnapshot,
  ProcessedTemplate,
  TemplateValidation,
  TemplateInput,
} from '@/lib/templates/types';
import {
  getLocalStorageTemplateInputs,
  saveLocalStorageTemplateInputs,
  templateSnapshot,
} from '@/lib/templates/storage';
import {
  processTemplate,
  addServiceInputs,
  filterUnavailablePresets,
  applyInputValue,
  getVisibleOptions,
} from '@/lib/templates/processors';
import { UseValidationModal } from './validationModal';
import { Mode } from '@/context/mode';

export interface UseTemplateWizardParams {
  status: StatusResponse | null;
  userData: any;
  setUserData: (updater: (prev: any) => any) => void;
  validationModal: UseValidationModal;
  templateValidations: Record<string, TemplateValidation>;
  setSelectedMenu: (menu: MenuId) => void;
  onOpenChange: (open: boolean) => void;
  mode: Mode;
}

export interface UseTemplateWizard {
  // State
  currentStep: WizardStep;
  /** Settings an update would change that the user has already changed. */
  pendingConflicts: TemplateUpdateConflict[];
  /** Applies the update, keeping the named fields as the user has them. */
  resolveConflicts: (keepMine: string[]) => void;
  cancelConflicts: () => void;
  processedTemplate: ProcessedTemplate | null;
  selectedServices: string[];
  inputValues: Record<string, string>;
  pendingTemplate: Template | null;
  templateInputOptions: Option[];
  templateInputValues: Record<string, any>;
  wizardHistory: WizardSnapshot[];
  isLoading: boolean;
  // Setters exposed to sub-components
  setSelectedServices: React.Dispatch<React.SetStateAction<string[]>>;
  setInputValues: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setTemplateInputValues: React.Dispatch<
    React.SetStateAction<Record<string, any>>
  >;
  setProcessedTemplate: React.Dispatch<
    React.SetStateAction<ProcessedTemplate | null>
  >;
  // Navigation
  executeLoadTemplate(template: Template): void;
  handleLoadTemplate(template: Template): void;
  handleServiceSelectionNext(): void;
  handleServiceSelectionSkip(): void;
  handleTemplateInputsNext(): void;
  pushHistory(): void;
  handleBack(): void;
  confirmLoadTemplate(): Promise<void>;
  handleCancel(): void;
}

export function useTemplateWizard({
  status,
  userData,
  setUserData,
  validationModal,
  templateValidations,
  setSelectedMenu,
  onOpenChange,
  mode,
}: UseTemplateWizardParams): UseTemplateWizard {
  const [currentStep, setCurrentStep] = useState<WizardStep>('browse');
  const [processedTemplate, setProcessedTemplate] =
    useState<ProcessedTemplate | null>(null);
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  const [pendingTemplate, setPendingTemplate] = useState<Template | null>(null);
  // An apply held at the conflict step, with everything needed to finish it once
  // the user has said which settings to keep.
  const [pendingConflicts, setPendingConflicts] = useState<
    TemplateUpdateConflict[]
  >([]);
  const [pendingCommit, setPendingCommit] = useState<
    ((keepMine: string[]) => void) | null
  >(null);
  const [templateInputOptions, setTemplateInputOptions] = useState<Option[]>(
    []
  );
  const [templateInputValues, setTemplateInputValues] = useState<
    Record<string, any>
  >({});
  const [wizardHistory, setWizardHistory] = useState<WizardSnapshot[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  /**
   * Push a deep snapshot of the current wizard state onto the history stack
   * before every forward navigation.
   */
  const pushHistory = () => {
    const snapshot: WizardSnapshot = {
      step: currentStep,
      processedTemplate: processedTemplate
        ? (JSON.parse(JSON.stringify(processedTemplate)) as ProcessedTemplate)
        : null,
      pendingTemplate: pendingTemplate
        ? (JSON.parse(JSON.stringify(pendingTemplate)) as Template)
        : null,
      templateInputOptions: JSON.parse(JSON.stringify(templateInputOptions)),
      templateInputValues: JSON.parse(JSON.stringify(templateInputValues)),
      selectedServices: [...selectedServices],
      inputValues: { ...inputValues },
    };
    setWizardHistory((prev) => [...prev, snapshot]);
  };

  /**
   * Go back one step by popping the last snapshot and restoring all wizard state.
   */
  const handleBack = () => {
    if (wizardHistory.length === 0) return;
    const snapshot = wizardHistory[wizardHistory.length - 1];
    setWizardHistory(wizardHistory.slice(0, -1));
    setCurrentStep(snapshot.step);
    setProcessedTemplate(snapshot.processedTemplate);
    setPendingTemplate(snapshot.pendingTemplate);
    setTemplateInputOptions(snapshot.templateInputOptions);
    setTemplateInputValues(snapshot.templateInputValues);
    setSelectedServices(snapshot.selectedServices);
    setInputValues(snapshot.inputValues);
  };

  /**
   * Returns the IDs of services from userData that are already enabled and
   * have credentials, filtered to only those present in serviceIds.
   */
  const getPreSelectedServices = (serviceIds: string[]): string[] =>
    ((userData?.services ?? []) as any[])
      .filter(
        (s) =>
          serviceIds.includes(s.id) &&
          s.enabled &&
          s.credentials &&
          Object.values(s.credentials).some((v) => v)
      )
      .map((s) => s.id);

  /**
   * Migrates config, stamps in input values, filters services,
   * resolves credential refs, merges into userData, then resets wizard state.
   */
  /**
   * Finishes an apply that stopped at the conflict step. keepMine names the
   * fields to leave as the user has them; everything else takes the update.
   */
  const resolveConflicts = (keepMine: string[]) => {
    // The pending call writes the config and then runs the same completion the
    // immediate path runs, so the notifications and the save-install switch
    // happen here too rather than only when there was nothing to ask about.
    pendingCommit?.(keepMine);
  };

  /**
   * Abandons an apply held at the conflict step. Clears the same transient
   * state a cancel does, or a later apply can reopen on a stale snapshot.
   */
  const cancelConflicts = () => {
    setPendingConflicts([]);
    setPendingCommit(null);
    setProcessedTemplate(null);
    setPendingTemplate(null);
    setTemplateInputValues({});
    setSelectedServices([]);
    setInputValues({});
    setWizardHistory([]);
    setCurrentStep('browse');
    setIsLoading(false);
  };

  const applyTemplate = async ({
    config,
    inputs,
    resolvedValues,
    selectedSvcs,
    templateName,
    setToSaveInstallMenu,
    templateId,
    templateVersion,
    templateSourceUrl,
  }: {
    config: any;
    inputs: TemplateInput[];
    resolvedValues: Record<string, string>;
    selectedSvcs: string[];
    templateName: string;
    setToSaveInstallMenu?: boolean;
    templateId?: string;
    templateVersion?: string;
    templateSourceUrl?: string;
  }) => {
    setIsLoading(true);
    try {
      const migratedData = applyMigrations(JSON.parse(JSON.stringify(config)));

      // The template as applied, kept so a later update can tell what the user
      // changed from what the template set. Taken before the loop below stamps
      // the user's inputs in, since those include service credentials.
      const appliedConfig = templateSnapshot(migratedData);

      inputs.forEach((input) => {
        const value = resolvedValues[input.key];
        if (value || !input.required) {
          const paths = Array.isArray(input.path) ? input.path : [input.path];
          for (const path of paths) {
            if (path.startsWith('services.')) {
              const pathParts = path.split('.');
              const serviceId = pathParts[1] as any;
              const credKey = pathParts[2];
              if (!migratedData.services) migratedData.services = [];
              let service = migratedData.services.find(
                (s: any) => s.id === serviceId
              );
              if (!service) {
                service = { id: serviceId, enabled: true, credentials: {} };
                migratedData.services.push(service);
              }
              if (!service.credentials) service.credentials = {};
              service.credentials[credKey] = value || '';
            } else {
              applyInputValue(migratedData, path, value || '');
            }
          }
        }
      });

      if (selectedSvcs.length > 0) {
        if (!migratedData.services) migratedData.services = [];

        const services = migratedData.services;

        selectedSvcs.forEach((svcId) => {
          const existing = services.find((s: any) => s.id === svcId);
          if (!existing) {
            services.push({
              id: svcId as ServiceId,
              enabled: true,
              credentials: {},
            });
          } else if (!existing.enabled) {
            existing.enabled = true;
          }
        });

        services.forEach((s: any) => {
          if (!selectedSvcs.includes(s.id)) {
            s.enabled = false;
          }
        });
      }

      resolveCredentialRefs(migratedData, resolvedValues);

      // Everything the user has changed since this template was applied, that
      // the update would change back. Empty on a first apply, and empty on an
      // update that touches nothing the user has an opinion about.
      const applied = (userData?.appliedTemplates ?? []).find(
        (t: any) => t.id === templateId
      );
      const plan = templateId
        ? planTemplateUpdate(applied?.config, userData, migratedData)
        : { changed: Object.keys(migratedData), conflicts: [] };
      const conflicts = plan.conflicts;

      // Writes the update, minus any field the user chose to keep, and records
      // the template as applied. The base stored here is the template's own
      // config either way, so a kept setting still reads as the user's change
      // at the next update rather than becoming the new baseline.
      const commit = (keepMine: string[] = []) => {
        // Only what the update actually changes, minus anything the user chose
        // to keep. Applying the whole config would reset customisations to
        // settings this update never touched, which is the thing the prompt
        // exists to prevent.
        const incoming: any = {};
        for (const field of plan.changed) {
          if (keepMine.includes(field)) continue;
          incoming[field] = (migratedData as any)[field];
        }
        setUserData((prev: any) => {
          // Credentials are left out of the conflict comparison, since they are
          // the user's rather than the template's. That means an update whose
          // services carry empty credentials raises no conflict — so without
          // this the keys would be replaced by nothing, unasked, by a step whose
          // whole promise is to ask first.
          //
          // Computed into a new array rather than assigned back into `incoming`:
          // an updater has to be safe to call twice, and `incoming` is from the
          // enclosing scope.
          if (!Array.isArray(incoming.services))
            return { ...prev, ...incoming };
          const services = incoming.services.map((service: any) => {
            const existing = (prev.services ?? []).find(
              (s: any) => s.id === service.id
            );
            const credentials = { ...(existing?.credentials ?? {}) };
            for (const [key, value] of Object.entries(
              service.credentials ?? {}
            )) {
              if (value !== '' && value !== undefined) credentials[key] = value;
            }
            return { ...service, credentials };
          });
          return { ...prev, ...incoming, services };
        });

        if (templateId && templateVersion) {
          setUserData((prev: any) => ({
            ...prev,
            appliedTemplates: [
              ...((prev.appliedTemplates ?? []) as any[]).filter(
                (t: any) => t.id !== templateId
              ),
              {
                id: templateId,
                version: templateVersion,
                config: appliedConfig,
                ...(templateSourceUrl ? { url: templateSourceUrl } : {}),
              },
            ],
          }));
        }
      };

      // Everything that happens once a template has actually been applied. Held
      // in one place because the conflict step applies it later, from a
      // different call, and a second copy of this would drift.
      const finish = () => {
        const addonsNeedingSetup = (migratedData.presets || [])
          .filter((preset: any) =>
            ['gdrive'].some((type) => preset.type.toLowerCase().includes(type))
          )
          .map((preset: any) => preset.options?.name || preset.type);

        toast.success(`Template "${templateName}" loaded successfully`);

        if (addonsNeedingSetup.length > 0) {
          setTimeout(() => {
            toast.info(
              `Note: ${addonsNeedingSetup.join(', ')} require additional setup. Please configure them in the Addons section.`,
              { duration: 8000 }
            );
          }, 1000);
        }

        setProcessedTemplate(null);
        setCurrentStep('browse');
        setSelectedServices([]);
        setInputValues({});
        setWizardHistory([]);
        setPendingTemplate(null);
        setTemplateInputValues({});
        setPendingConflicts([]);
        setPendingCommit(null);
        setIsLoading(false);
        if (setToSaveInstallMenu) setSelectedMenu('save-install');
        onOpenChange(false);
      };

      if (conflicts.length > 0) {
        setPendingConflicts(conflicts);
        setPendingCommit(() => (keepMine: string[]) => {
          commit(keepMine);
          finish();
        });
        setCurrentStep('resolveConflicts');
        setIsLoading(false);
        return;
      }

      commit();
      finish();
    } catch (err) {
      console.error('Error loading template:', err);
      toast.error('Failed to load template');
    } finally {
      setIsLoading(false);
    }
  };

  /** Process template, navigate to the appropriate step. */
  const proceedWithTemplate = (template: Template) => {
    filterUnavailablePresets(template.config, status);
    const processed = processTemplate(template, status, userData);
    setProcessedTemplate(processed);

    if (processed.skipServiceSelection) {
      if (processed.services.length === 1) {
        const serviceInputs = addServiceInputs(
          processed,
          processed.services,
          status,
          userData
        );
        processed.inputs = [...serviceInputs, ...processed.inputs];
        setSelectedServices(processed.services);
      }

      if (processed.inputs.length === 0) {
        applyTemplate({
          config: template.config,
          inputs: [],
          resolvedValues: {},
          selectedSvcs:
            processed.services.length === 1 ? processed.services : [],
          templateName: template.metadata.name,
          setToSaveInstallMenu: template.metadata.setToSaveInstallMenu,
          templateId: template.metadata.id,
          templateVersion: template.metadata.version,
          templateSourceUrl: template.metadata.sourceUrl,
        });
        return;
      }

      setInputValues(
        processed.inputs.reduce(
          (acc, input) => ({ ...acc, [input.key]: input.value }),
          {}
        )
      );
      setCurrentStep('inputs');
    } else if (processed.showServiceSelection) {
      setSelectedServices(getPreSelectedServices(processed.services));
      setCurrentStep('selectService');
    } else {
      if (processed.inputs.length === 0) {
        applyTemplate({
          config: template.config,
          inputs: [],
          resolvedValues: {},
          selectedSvcs: [],
          templateName: template.metadata.name,
          setToSaveInstallMenu: template.metadata.setToSaveInstallMenu,
          templateId: template.metadata.id,
          templateVersion: template.metadata.version,
          templateSourceUrl: template.metadata.sourceUrl,
        });
        return;
      }
      setInputValues(
        processed.inputs.reduce(
          (acc, input) => ({ ...acc, [input.key]: input.value }),
          {}
        )
      );
      setCurrentStep('inputs');
    }
  };

  const executeLoadTemplate = (template: Template) => {
    pushHistory();

    const options: Option[] = template.metadata.inputs || [];
    if (options.length > 0) {
      const defaults: Record<string, any> = {};
      for (const opt of options) {
        if (opt.default !== undefined) {
          defaults[opt.id] = opt.default;
        } else if (opt.type === 'boolean') {
          defaults[opt.id] = false;
        }
        if (
          opt.type === 'subsection' &&
          Array.isArray((opt as any).subOptions)
        ) {
          const subDefaults: Record<string, any> = {};
          for (const sub of (opt as any).subOptions as Option[]) {
            if (sub.default !== undefined) {
              subDefaults[sub.id] = sub.default;
            } else if (sub.type === 'boolean') {
              subDefaults[sub.id] = false;
            }
          }
          if (Object.keys(subDefaults).length > 0) {
            defaults[opt.id] = { ...subDefaults, ...(defaults[opt.id] ?? {}) };
          }
        }
      }
      const saved = getLocalStorageTemplateInputs(template.metadata.id);

      const mergeWithDefaults = (
        base: Record<string, any>,
        overrides: Record<string, any>
      ): Record<string, any> => {
        const result = { ...base };
        for (const key of Object.keys(overrides)) {
          if (
            overrides[key] !== null &&
            typeof overrides[key] === 'object' &&
            !Array.isArray(overrides[key]) &&
            typeof base[key] === 'object' &&
            base[key] !== null &&
            !Array.isArray(base[key])
          ) {
            result[key] = { ...base[key], ...overrides[key] };
          } else {
            result[key] = overrides[key];
          }
        }
        return result;
      };

      const initialValues = mergeWithDefaults(defaults, saved);

      const processed = processTemplate(template, status, userData);
      if (processed.showServiceSelection) {
        setProcessedTemplate(processed);
        setPendingTemplate(template);
        setTemplateInputOptions(options);
        setTemplateInputValues(initialValues);
        setSelectedServices(getPreSelectedServices(processed.services));
        setCurrentStep('selectService');
        return;
      }

      setProcessedTemplate(null);
      setPendingTemplate(template);
      setTemplateInputOptions(options);
      setTemplateInputValues(initialValues);
      setCurrentStep('templateInputs');
      return;
    }

    proceedWithTemplate(template);
  };

  const handleLoadTemplate = (template: Template) => {
    const validation = templateValidations[template.metadata.id];
    if (
      validation &&
      (validation.errors.length > 0 || validation.warnings.length > 0)
    ) {
      validationModal.open({
        template,
        data: validation,
        proceedLabel: 'Load Anyway',
        onProceed:
          validation.errors.length === 0
            ? () => executeLoadTemplate(template)
            : null,
      });
      return;
    }
    executeLoadTemplate(template);
  };

  const handleServiceSelectionNext = () => {
    if (!processedTemplate) return;

    if (!processedTemplate.allowSkipService && selectedServices.length === 0) {
      toast.error('Please select at least one service');
      return;
    }

    pushHistory();

    const serviceInputs = addServiceInputs(
      processedTemplate,
      selectedServices,
      status,
      userData
    );
    const allInputs = [...serviceInputs, ...processedTemplate.inputs];
    processedTemplate.inputs = allInputs;

    setProcessedTemplate((prev) => {
      if (!prev) return null;
      for (const serviceId of selectedServices) {
        const service = (prev.template.config.services as any[])?.find?.(
          (s: any) => s.id === serviceId
        );
        if (service) {
          service.enabled = true;
        }
      }
      return prev;
    });

    if (pendingTemplate !== null) {
      setCurrentStep('templateInputs');
      return;
    }

    setInputValues(
      allInputs.reduce(
        (acc, input) => ({ ...acc, [input.key]: input.value }),
        {}
      )
    );
    setCurrentStep('inputs');
  };

  const handleServiceSelectionSkip = () => {
    if (!processedTemplate) return;

    if (!processedTemplate.allowSkipService) {
      toast.error('Service selection cannot be skipped for this template');
      return;
    }

    pushHistory();
    setSelectedServices([]);

    if (pendingTemplate !== null) {
      setCurrentStep('templateInputs');
      return;
    }

    setInputValues(
      processedTemplate.inputs.reduce(
        (acc, input) => ({ ...acc, [input.key]: input.value }),
        {}
      )
    );
    setCurrentStep('inputs');
  };

  const handleTemplateInputsNext = () => {
    if (!pendingTemplate) return;

    const visibleOptions = getVisibleOptions(
      mode,
      templateInputOptions,
      templateInputValues,
      selectedServices
    );

    const missingRequired = visibleOptions.filter(
      (opt) =>
        opt.required &&
        (templateInputValues[opt.id] === undefined ||
          templateInputValues[opt.id] === null ||
          templateInputValues[opt.id] === '')
    );
    if (missingRequired.length > 0) {
      toast.error(
        `Please fill in required fields: ${missingRequired.map((o) => o.name || o.id).join(', ')}`
      );
      return;
    }

    pushHistory();

    const resolvedConfig = applyTemplateConditionals(
      JSON.parse(JSON.stringify(pendingTemplate.config)),
      templateInputValues,
      selectedServices
    );

    filterUnavailablePresets(resolvedConfig, status);

    const resolvedTemplate: Template = {
      ...pendingTemplate,
      config: resolvedConfig,
    };

    saveLocalStorageTemplateInputs(
      pendingTemplate.metadata.id,
      templateInputValues
    );

    setPendingTemplate(null);
    setTemplateInputOptions([]);

    if (processedTemplate !== null) {
      const freshProcessed = processTemplate(
        resolvedTemplate,
        status,
        userData
      );
      const serviceCredInputs = processedTemplate.inputs.filter((input) =>
        Array.isArray(input.path)
          ? input.path.some((p) => p.startsWith('services.'))
          : input.path.startsWith('services.')
      );
      freshProcessed.inputs = [...serviceCredInputs, ...freshProcessed.inputs];
      setProcessedTemplate(freshProcessed);
      setInputValues(
        freshProcessed.inputs.reduce(
          (acc, input) => ({ ...acc, [input.key]: input.value }),
          {}
        )
      );
      setCurrentStep('inputs');
    } else {
      proceedWithTemplate(resolvedTemplate);
    }
  };

  const confirmLoadTemplate = async () => {
    if (!processedTemplate) return;

    const missingRequired = processedTemplate.inputs.filter(
      (input) => input.required && !inputValues[input.key]?.trim()
    );

    if (missingRequired.length > 0) {
      toast.error(
        `Please fill in all required fields: ${missingRequired.map((i) => i.label).join(', ')}`
      );
      return;
    }

    await applyTemplate({
      config: processedTemplate.template.config,
      inputs: processedTemplate.inputs,
      resolvedValues: inputValues,
      selectedSvcs: selectedServices,
      templateName: processedTemplate.template.metadata.name,
      setToSaveInstallMenu:
        processedTemplate.template.metadata.setToSaveInstallMenu,
      templateId: processedTemplate.template.metadata.id,
      templateVersion: processedTemplate.template.metadata.version,
      templateSourceUrl: processedTemplate.template.metadata.sourceUrl,
    });
  };

  const handleCancel = () => {
    setProcessedTemplate(null);
    setPendingTemplate(null);
    setTemplateInputOptions([]);
    setTemplateInputValues({});
    setCurrentStep('browse');
    setSelectedServices([]);
    setInputValues({});
    setWizardHistory([]);
    onOpenChange(false);
  };

  return {
    currentStep,
    pendingConflicts,
    resolveConflicts,
    cancelConflicts,
    processedTemplate,
    selectedServices,
    inputValues,
    pendingTemplate,
    templateInputOptions,
    templateInputValues,
    wizardHistory,
    isLoading,
    setSelectedServices,
    setInputValues,
    setTemplateInputValues,
    setProcessedTemplate,
    executeLoadTemplate,
    handleLoadTemplate,
    handleServiceSelectionNext,
    handleServiceSelectionSkip,
    handleTemplateInputsNext,
    pushHistory,
    handleBack,
    confirmLoadTemplate,
    handleCancel,
  };
}
