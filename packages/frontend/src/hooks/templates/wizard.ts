'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { Template, Option, StatusResponse } from '@aiostreams/core';
import { applyMigrations, useUserData } from '@/context/userData';
import {
  applyTemplateConditionals,
  resolveCredentialRefs,
  evaluateTemplateCondition,
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
} from '@/lib/templates/storage';
import {
  processTemplate,
  addServiceInputs,
  filterUnavailablePresets,
  applyInputValue,
} from '@/lib/templates/processors';
import { UseValidationModal } from './validationModal';

export interface UseTemplateWizardParams {
  status: StatusResponse | null;
  userData: any;
  setUserData: (updater: (prev: any) => any) => void;
  validationModal: UseValidationModal;
  templateValidations: Record<string, TemplateValidation>;
  setSelectedMenu: (menu: string) => void;
  onOpenChange: (open: boolean) => void;
  mode: string;
}

export interface UseTemplateWizard {
  // State
  currentStep: WizardStep;
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
   * Migrates config, stamps in input values, filters services,
   * resolves credential refs, merges into userData, then resets wizard state.
   */
  const applyTemplate = async ({
    config,
    inputs,
    resolvedValues,
    selectedSvcs,
    templateName,
    setToSaveInstallMenu,
  }: {
    config: any;
    inputs: TemplateInput[];
    resolvedValues: Record<string, string>;
    selectedSvcs: string[];
    templateName: string;
    setToSaveInstallMenu?: boolean;
  }) => {
    setIsLoading(true);
    try {
      const migratedData = applyMigrations(JSON.parse(JSON.stringify(config)));

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

      if (selectedSvcs.length > 0 && migratedData.services) {
        migratedData.services = migratedData.services.filter((s: any) =>
          selectedSvcs.includes(s.id)
        );
      }

      resolveCredentialRefs(migratedData, resolvedValues);
      setUserData((prev: any) => ({ ...prev, ...migratedData }));

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
      if (setToSaveInstallMenu) setSelectedMenu('save-install');
      onOpenChange(false);
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
      setSelectedServices([]);
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
        setSelectedServices([]);
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

    const visibleOptions = (
      mode === 'noob'
        ? templateInputOptions.filter(
            (opt) => opt.advanced !== true && opt.showInSimpleMode !== false
          )
        : templateInputOptions
    ).filter((opt) =>
      (opt as any).__if
        ? evaluateTemplateCondition(
            (opt as any).__if,
            templateInputValues,
            selectedServices
          )
        : true
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
