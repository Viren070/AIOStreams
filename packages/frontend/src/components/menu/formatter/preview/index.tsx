import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Braces,
  Eye,
  FileText,
  Hash,
  Info,
  RotateCcw,
  Waves,
} from 'lucide-react';
import { toast } from 'sonner';
import { collectFieldReferences } from '../../../../../../core/src/formatters/engine';
import { useUserData } from '@/context/userData';
import { useStatus } from '@/context/status';
import { renderFormatter } from '@/lib/formatter-render';
import { cn } from '../../../ui/core/styling';
import { SettingsCard } from '../../../shared/settings-card';
import { MenuTabs } from '../../../shared/menu-tabs';
import { IconButton } from '../../../ui/button';
import { Select } from '../../../ui/select';
import { Tooltip } from '../../../ui/tooltip';
import { FormatQueue } from '../format-queue';
import { getTemplates } from '../templates';
import { PreviewFieldsProvider } from './fields';
import { FormatterPreviewBox } from './preview-box';
import {
  applyScenario,
  buildParsedFile,
  buildParsedFileWithoutOverrides,
  DEFAULT_PREVIEW_INPUT,
  loadPreviewInput,
  PREVIEW_SCENARIOS,
  PreviewInput,
  savePreviewInput,
  tabHasUsedField,
} from './state';
import { SourceTab } from './tabs/source';
import { ParsedFileTab } from './tabs/parsed-file';
import { StreamTab } from './tabs/stream';
import { MetadataTab } from './tabs/metadata';
import { ScoringTab } from './tabs/scoring';

export function FormatterPreview() {
  const { userData } = useUserData();
  const { status } = useStatus();
  const addonName = status?.settings.addonName;
  const formatQueueRef = useRef<FormatQueue>(new FormatQueue(200));

  const [input, setInput] = useState<PreviewInput>(loadPreviewInput);
  const [activeTab, setActiveTab] = useState('source');
  const [onlyUsed, setOnlyUsed] = useState(false);
  const [formattedStream, setFormattedStream] = useState<{
    name: string;
    description: string;
  } | null>(null);

  const patch = useCallback((partial: Partial<PreviewInput>) => {
    setInput((previous) => ({ ...previous, ...partial }));
  }, []);

  useEffect(() => {
    savePreviewInput(input);
  }, [input]);

  const templates = getTemplates(userData);
  const usedFields = useMemo(
    () =>
      new Set([
        ...collectFieldReferences(templates.name),
        ...collectFieldReferences(templates.description),
      ]),
    [templates.name, templates.description]
  );

  const parsedFile = useMemo(
    () => buildParsedFileWithoutOverrides(input),
    [input]
  );
  const effectiveParsedFile = useMemo(() => buildParsedFile(input), [input]);

  const formatStream = useCallback(async () => {
    try {
      const formatted = await renderFormatter(
        templates,
        userData,
        addonName,
        input
      );
      setFormattedStream(formatted);
    } catch (error) {
      console.error('Error formatting stream:', error);
      toast.error(`Failed to format stream: ${error}`);
    }
  }, [input, userData, templates.name, templates.description, addonName]);

  useEffect(() => {
    formatQueueRef.current.enqueue(formatStream);
  }, [formatStream]);

  const allTabs = [
    {
      value: 'source',
      label: 'Source',
      icon: <FileText className="w-4 h-4" />,
      content: <SourceTab input={input} patch={patch} />,
    },
    {
      value: 'stream',
      label: 'Stream',
      icon: <Waves className="w-4 h-4" />,
      content: <StreamTab input={input} patch={patch} />,
    },
    {
      value: 'parsed',
      label: 'Parsed File',
      icon: <Braces className="w-4 h-4" />,
      content: (
        <ParsedFileTab
          input={input}
          patch={patch}
          parsed={parsedFile}
          effective={effectiveParsedFile}
        />
      ),
    },
    {
      value: 'scoring',
      label: 'Scoring',
      icon: <Hash className="w-4 h-4" />,
      content: <ScoringTab input={input} patch={patch} />,
    },
    {
      value: 'metadata',
      label: 'Metadata',
      icon: <Info className="w-4 h-4" />,
      content: <MetadataTab input={input} patch={patch} />,
    },
  ];

  // under the filter, a tab with nothing the template reads is just noise
  const tabs = onlyUsed
    ? allTabs.filter((tab) => tabHasUsedField(tab.value, usedFields))
    : allTabs;

  // keep the active tab valid when the filter hides it
  useEffect(() => {
    if (tabs.length && !tabs.some((tab) => tab.value === activeTab)) {
      setActiveTab(tabs[0].value);
    }
  }, [tabs, activeTab]);

  const isDefault =
    JSON.stringify(input) === JSON.stringify(DEFAULT_PREVIEW_INPUT);

  return (
    <SettingsCard
      title="Preview"
      description="See how your streams would be formatted based on controllable variables"
    >
      <div className="space-y-4">
        <FormatterPreviewBox
          name={formattedStream?.name}
          description={formattedStream?.description}
        />

        <PreviewToolbar
          scenario={input.scenario}
          onScenario={(id) => setInput(applyScenario(id))}
          onlyUsed={onlyUsed}
          onOnlyUsed={setOnlyUsed}
          usedCount={usedFields.size}
          onReset={() => setInput(DEFAULT_PREVIEW_INPUT)}
          resetDisabled={isDefault}
        />

        <PreviewFieldsProvider used={usedFields} onlyUsed={onlyUsed}>
          {tabs.length ? (
            <MenuTabs
              tabs={tabs}
              activeTab={activeTab}
              onTabChange={setActiveTab}
              revealOnChange
            />
          ) : (
            <p className="text-center text-sm text-[--muted] py-6">
              This formatter reads no controllable fields.
            </p>
          )}
        </PreviewFieldsProvider>
      </div>
    </SettingsCard>
  );
}

function PreviewToolbar({
  scenario,
  onScenario,
  onlyUsed,
  onOnlyUsed,
  usedCount,
  onReset,
  resetDisabled,
}: {
  scenario: string;
  onScenario: (id: string) => void;
  onlyUsed: boolean;
  onOnlyUsed: (value: boolean) => void;
  usedCount: number;
  onReset: () => void;
  resetDisabled: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-md border border-gray-800 bg-gray-900/60 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2 min-w-0">
        <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-[--muted]">
          Scenario
        </span>
        <Select
          className="w-full sm:w-56"
          value={scenario}
          options={PREVIEW_SCENARIOS.map((preset) => ({
            label: preset.label,
            value: preset.id,
          }))}
          onValueChange={onScenario}
        />
      </div>

      <div className="flex items-center justify-between gap-2 sm:justify-end">
        <Tooltip
          trigger={
            <button
              type="button"
              onClick={() => onOnlyUsed(!onlyUsed)}
              className={cn(
                'flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors',
                onlyUsed
                  ? 'border-[--brand] bg-brand/10 text-[--brand]'
                  : 'border-gray-800 text-[--muted] hover:text-[--foreground]'
              )}
            >
              <Eye className="w-4 h-4" />
              Used only
              <span className="rounded-full bg-gray-800 px-2 py-0.5 text-xs leading-none">
                {usedCount}
              </span>
            </button>
          }
        >
          Show only the fields this formatter reads
        </Tooltip>
        <Tooltip
          trigger={
            <IconButton
              intent="gray-subtle"
              icon={<RotateCcw className="w-4 h-4" />}
              aria-label="Reset preview inputs"
              disabled={resetDisabled}
              onClick={onReset}
            />
          }
        >
          Reset all preview inputs
        </Tooltip>
      </div>
    </div>
  );
}
