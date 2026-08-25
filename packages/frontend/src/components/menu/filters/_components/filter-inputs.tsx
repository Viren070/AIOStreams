import { ReactNode, useCallback, useRef } from 'react';
import { useDisclosure } from '@/hooks/disclosure';
import { toast } from 'sonner';
import { IconButton } from '../../../ui/button';
import { TextInput } from '../../../ui/text-input';
import { NumberInput } from '../../../ui/number-input';
import { Tooltip } from '../../../ui/tooltip';
import { Checkbox } from '../../../ui/checkbox';
import { SettingsCard } from '../../../shared/settings-card';
import { ImportModal } from '../../../shared/import-modal';
import {
  ItemActions,
  SortableList,
  SortableRow,
  rowActionsClass,
  rowControlsClass,
  rowLeadControlClass,
  useSortableRows,
  type SortableRows,
} from '../../../shared/sortable-rows';
import { SyncedUrlInputs, type SyncConfig } from './synced-patterns';
import { FaPlus, FaFileExport, FaFileImport, FaLink } from 'react-icons/fa';
import { UserData } from '@aiostreams/core';

const scoreFieldClass = 'md:flex-1 md:min-w-[100px]';

/** Parse a `<SYNCED: url>` placeholder, returning the URL or null. */
function parseSyncedUrl(value: string): string | null {
  if (!value.startsWith('<SYNCED: ') || !value.endsWith('>')) return null;
  const url = value.slice(9, -1).trim();
  return url.length > 0 ? url : null;
}

function toId(val: string) {
  return val.charAt(0).toLowerCase() + val.slice(1).replace(/\s+/g, '');
}
// Shared helpers

/** Download `data` as a JSON file. */
function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Derive a filename from a label, e.g. "Required Keywords" → "required-keywords-2026-02-08.14-56".json */
function labelToFilename(label: string) {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const dateStr = `${yyyy}-${mm}-${dd}.${hh}-${min}`;
  return `${label.toLowerCase().replace(/\s+/g, '-')}-${dateStr}.json`;
}

/**
 * Read-only cells for an inline synced-URL placeholder. Synced rows have no
 * checkbox, so on lists that have one the link icon takes that column to keep
 * the fields lined up; elsewhere it sits inside the field.
 */
function PlaceholderRow({
  rows,
  index,
  url,
  iconPosition,
}: {
  rows: SortableRows;
  index: number;
  url: string;
  iconPosition?: 'inside' | 'outside';
}) {
  const handleJumpToUrl = useCallback(
    (e: React.MouseEvent) => {
      const container = (e.currentTarget as HTMLElement).closest(
        '[data-settings-card]'
      );
      const row = (container ?? document).querySelector(
        `[data-synced-url="${window.CSS.escape(url)}"]`
      );
      if (!row) return;
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Open the disclosure if it's closed
      setTimeout(() => {
        const trigger = row.querySelector<HTMLButtonElement>(
          '[data-radix-collection-item]'
        );
        if (trigger?.dataset.state !== 'open') {
          trigger?.click();
        }
      }, 400);
    },
    [url]
  );

  const linkButton = (
    <Tooltip
      trigger={
        <button
          type="button"
          aria-label="Jump to synced URL"
          onClick={handleJumpToUrl}
          className="h-6 w-6 flex items-center justify-center cursor-pointer hover:opacity-80 transition-opacity shrink-0"
        >
          <FaLink className="text-[--brand] text-base" />
        </button>
      }
    >
      Jump to synced URL
    </Tooltip>
  );

  return (
    <>
      <div className={rowControlsClass}>
        {iconPosition !== 'inside' && (
          <div className={rowLeadControlClass}>{linkButton}</div>
        )}
        <div className={rowActionsClass}>
          <ItemActions rows={rows} index={index} />
        </div>
      </div>
      <div className="md:flex-1 min-w-0 flex items-center gap-2 rounded-[--radius] bg-[--paper] border border-[--border] shadow-sm h-10 px-3 opacity-75 overflow-hidden">
        {iconPosition === 'inside' && linkButton}
        <span className="text-sm text-[--muted] font-mono truncate min-w-0 flex-1">
          {url}
        </span>
      </div>
    </>
  );
}

/**
 * Map items into draggable cards, substituting a read-only body for
 * synced-URL entries.
 */
function renderRows<T>(
  rows: SortableRows,
  items: T[],
  getField: (item: T) => string,
  renderItem: (item: T, index: number) => ReactNode,
  options?: { syncEnabled?: boolean; iconPosition?: 'inside' | 'outside' }
): ReactNode[] {
  return items.map((item, index) => {
    const key = rows.keyAt(index);
    const url = options?.syncEnabled ? parseSyncedUrl(getField(item)) : null;
    return (
      <SortableRow key={key} id={key}>
        {url ? (
          <PlaceholderRow
            rows={rows}
            index={index}
            url={url}
            iconPosition={options?.iconPosition}
          />
        ) : (
          renderItem(item, index)
        )}
      </SortableRow>
    );
  });
}

/**
 * Hook that encapsulates the import-modal disclosure, a validated import
 * handler, and a JSON-export handler.
 */
function useImportExport<T>(
  getExportData: () => unknown,
  onImport: (data: any) => boolean,
  label: string
) {
  const modal = useDisclosure(false);

  const handleImport = useCallback(
    (data: any) => {
      if (!onImport(data)) {
        toast.error('Invalid import format');
      }
    },
    [onImport]
  );

  const handleExport = useCallback(() => {
    downloadJson(getExportData(), labelToFilename(label));
  }, [getExportData, label]);

  return { modal, handleImport, handleExport } as const;
}

// Reusable list footer (Add + Import/Export)

interface ListFooterProps {
  onAdd: () => void;
  onImportClick: () => void;
  onExport: () => void;
  children?: ReactNode;
}

function ListFooter({
  onAdd,
  onImportClick,
  onExport,
  children,
}: ListFooterProps) {
  return (
    <div className="mt-2 flex gap-2 items-center">
      <IconButton
        rounded
        size="sm"
        intent="primary-subtle"
        icon={<FaPlus />}
        onClick={onAdd}
      />
      {children}
      <div className="ml-auto flex gap-2">
        <Tooltip
          trigger={
            <IconButton
              rounded
              size="sm"
              intent="primary-subtle"
              icon={<FaFileImport />}
              onClick={onImportClick}
            />
          }
        >
          Import
        </Tooltip>
        <Tooltip
          trigger={
            <IconButton
              rounded
              size="sm"
              intent="primary-subtle"
              icon={<FaFileExport />}
              onClick={onExport}
            />
          }
        >
          Export
        </Tooltip>
      </div>
    </div>
  );
}

// TextInputs

export type TextInputProps = {
  fieldName?: string;
  itemName: string;
  label: string;
  help: string;
  values: string[];
  onValuesChange: (values: string[]) => void;
  placeholder?: string;
  syncConfig?: SyncConfig;
  disabled?: boolean;
};

export function TextInputs({
  fieldName,
  itemName,
  label,
  help,
  values,
  onValuesChange,
  placeholder,
  syncConfig,
  disabled,
}: TextInputProps) {
  const valuesRef = useRef(values);
  valuesRef.current = values;

  const rows = useSortableRows(values, onValuesChange);

  const getExportData = useCallback(() => ({ values: valuesRef.current }), []);
  const handleImportData = useCallback(
    (data: any) => {
      if (Array.isArray(data.values)) {
        onValuesChange(data.values);
        return true;
      }
      return false;
    },
    [onValuesChange]
  );
  const { modal, handleImport, handleExport } = useImportExport(
    getExportData,
    handleImportData,
    label
  );

  const handleValueChange = useCallback(
    (newValue: string, index: number) => {
      const current = valuesRef.current;
      onValuesChange([
        ...current.slice(0, index),
        newValue,
        ...current.slice(index + 1),
      ]);
    },
    [onValuesChange]
  );

  return (
    <SettingsCard
      id={fieldName ?? toId(label)}
      title={label}
      description={help}
      key={label}
    >
      <SortableList rows={rows}>
        {renderRows(
          rows,
          values,
          (v) => v,
          (value, index) => (
            <>
              <div className={rowActionsClass}>
                <ItemActions rows={rows} index={index} />
              </div>
              <div className="md:flex-1">
                <TextInput
                  value={value}
                  aria-label={itemName}
                  placeholder={placeholder ?? itemName}
                  onValueChange={(newValue) =>
                    handleValueChange(newValue, index)
                  }
                />
              </div>
            </>
          ),
          { syncEnabled: !!syncConfig, iconPosition: 'inside' }
        )}
      </SortableList>
      <ListFooter
        onAdd={() => onValuesChange([...values, ''])}
        onImportClick={modal.open}
        onExport={handleExport}
      />
      <ImportModal
        open={modal.isOpen}
        onOpenChange={modal.toggle}
        onImport={handleImport}
      />
      {syncConfig && (
        <SyncedUrlInputs syncConfig={syncConfig} renderType="simple" />
      )}
    </SettingsCard>
  );
}

// ToggleableTextInputs

export type ToggleableTextInputProps = {
  title: string;
  description: string;
  fieldName?: string;
  values: { expression: string; enabled: boolean }[];
  onValuesChange: (values: { expression: string; enabled: boolean }[]) => void;
  onExpressionChange: (expression: string, index: number) => void;
  onEnabledChange?: (enabled: boolean, index: number) => void;
  placeholder?: string;
  syncConfig?: SyncConfig;
};

export function ToggleableTextInputs({
  title,
  fieldName,
  description,
  values,
  onValuesChange,
  onExpressionChange,
  onEnabledChange,
  placeholder,
  syncConfig,
}: ToggleableTextInputProps) {
  const valuesRef = useRef(values);
  valuesRef.current = values;

  const rows = useSortableRows(values, onValuesChange);

  const getExportData = useCallback(
    () =>
      valuesRef.current.map((v) => ({
        expression: v.expression,
        enabled: v.enabled,
      })),
    []
  );
  const handleImportData = useCallback(
    (data: any) => {
      // Support both new format [{expression, enabled}] and legacy format {values: string[]}
      if (
        Array.isArray(data) &&
        data.every((v: any) => typeof v.expression === 'string')
      ) {
        onValuesChange(
          data.map((v: { expression: string; enabled?: boolean }) => ({
            expression: v.expression,
            enabled: v.enabled ?? true,
          }))
        );
        return true;
      }
      if (Array.isArray(data?.values)) {
        onValuesChange(
          data.values.map((v: string) => ({
            expression: v,
            enabled: true,
          }))
        );
        return true;
      }
      return false;
    },
    [onValuesChange]
  );
  const { modal, handleImport, handleExport } = useImportExport(
    getExportData,
    handleImportData,
    title
  );

  return (
    <SettingsCard
      id={fieldName ?? toId(title)}
      title={title}
      description={description}
    >
      <SortableList rows={rows}>
        {renderRows(
          rows,
          values,
          (v) => v.expression,
          (value, index) => (
            <>
              <div className={rowControlsClass}>
                <div className={rowLeadControlClass}>
                  <Checkbox
                    value={value.enabled ?? true}
                    defaultValue={true}
                    size="lg"
                    aria-label="Enabled"
                    onValueChange={(v) => {
                      if (onEnabledChange) {
                        onEnabledChange(v === true, index);
                      }
                    }}
                  />
                </div>
                <div className={rowActionsClass}>
                  <ItemActions rows={rows} index={index} />
                </div>
              </div>
              <div className="md:flex-1">
                <TextInput
                  value={value.expression}
                  aria-label="Expression"
                  placeholder={placeholder}
                  disabled={value.enabled === false}
                  onValueChange={(newValue) =>
                    onExpressionChange(newValue, index)
                  }
                />
              </div>
            </>
          ),
          { syncEnabled: !!syncConfig }
        )}
      </SortableList>
      <ListFooter
        onAdd={() =>
          onValuesChange([...values, { expression: '', enabled: true }])
        }
        onImportClick={modal.open}
        onExport={handleExport}
      />
      <ImportModal
        open={modal.isOpen}
        onOpenChange={modal.toggle}
        onImport={handleImport}
      />
      {syncConfig && (
        <SyncedUrlInputs syncConfig={syncConfig} renderType="nameable" />
      )}
    </SettingsCard>
  );
}

// TwoTextInputs (KeyValueInput)

export type KeyValueInputProps = {
  title: string;
  description: string;
  keyId: string;
  keyName: string;
  keyPlaceholder: string;
  valueId: string;
  valueName: string;
  valuePlaceholder: string;
  values: { name: string; value: string }[];
  onValuesChange: (values: { name: string; value: string }[]) => void;
  onValueChange: (value: string, index: number) => void;
  onKeyChange: (key: string, index: number) => void;
  disabled?: boolean;
  syncConfig?: SyncConfig;
};

export function TwoTextInputs({
  title,
  description,
  keyName,
  keyId,
  keyPlaceholder,
  valueId,
  valueName,
  valuePlaceholder,
  values,
  onValuesChange,
  onValueChange,
  onKeyChange,
  disabled,
  syncConfig,
}: KeyValueInputProps) {
  const valuesRef = useRef(values);
  valuesRef.current = values;

  const rows = useSortableRows(values, onValuesChange);

  const getExportData = useCallback(
    () =>
      valuesRef.current.map((v) => ({ [keyId]: v.name, [valueId]: v.value })),
    [keyId, valueId]
  );
  const handleImportData = useCallback(
    (data: any) => {
      if (
        Array.isArray(data) &&
        data.every(
          (v: Record<string, string>) =>
            typeof v[keyId] === 'string' && typeof v[valueId] === 'string'
        )
      ) {
        onValuesChange(
          data.map((v: Record<string, string>) => ({
            name: v[keyId],
            value: v[valueId],
          }))
        );
        return true;
      }
      return false;
    },
    [onValuesChange, keyId, valueId]
  );
  const { modal, handleImport, handleExport } = useImportExport(
    getExportData,
    handleImportData,
    title
  );

  return (
    <SettingsCard title={title} description={description}>
      <SortableList rows={rows}>
        {renderRows(
          rows,
          values,
          (v) => v.value,
          (value, index) => (
            <>
              <div className={rowActionsClass}>
                <ItemActions rows={rows} index={index} />
              </div>
              <div className="md:flex-1">
                <TextInput
                  value={value.name}
                  aria-label={keyName}
                  placeholder={keyPlaceholder}
                  onValueChange={(newValue) => onKeyChange(newValue, index)}
                />
              </div>
              <div className="md:flex-1">
                <TextInput
                  value={value.value}
                  aria-label={valueName}
                  placeholder={valuePlaceholder}
                  onValueChange={(newValue) => onValueChange(newValue, index)}
                />
              </div>
            </>
          ),
          { syncEnabled: !!syncConfig, iconPosition: 'inside' }
        )}
      </SortableList>
      <ListFooter
        onAdd={() => onValuesChange([...values, { name: '', value: '' }])}
        onImportClick={modal.open}
        onExport={handleExport}
      />
      <ImportModal
        open={modal.isOpen}
        onOpenChange={modal.toggle}
        onImport={handleImport}
      />
      {syncConfig && (
        <SyncedUrlInputs syncConfig={syncConfig} renderType="nameable" />
      )}
    </SettingsCard>
  );
}

// RankedExpressionInputs

export type RankedExpressionInputProps = {
  title: string;
  fieldName?: string;
  description: string;
  values: { expression: string; score: number; enabled: boolean }[];
  onValuesChange: (
    values: { expression: string; score: number; enabled: boolean }[]
  ) => void;
  onExpressionChange: (expression: string, index: number) => void;
  onScoreChange: (score: number, index: number) => void;
  onEnabledChange?: (enabled: boolean, index: number) => void;
  syncConfig?: SyncConfig;
};

export function RankedExpressionInputs({
  title,
  fieldName,
  description,
  values,
  onValuesChange,
  onExpressionChange,
  onScoreChange,
  onEnabledChange,
  syncConfig,
}: RankedExpressionInputProps) {
  const valuesRef = useRef(values);
  valuesRef.current = values;

  const rows = useSortableRows(values, onValuesChange);

  const getExportData = useCallback(
    () =>
      valuesRef.current.map((v) => ({
        expression: v.expression,
        score: v.score,
        enabled: v.enabled,
      })),
    []
  );
  const handleImportData = useCallback(
    (data: any) => {
      if (
        Array.isArray(data) &&
        data.every(
          (v: { expression?: string; score?: number }) =>
            typeof v.expression === 'string' && typeof v.score === 'number'
        )
      ) {
        onValuesChange(
          data.map(
            (v: { expression: string; score: number; enabled?: boolean }) => ({
              expression: v.expression,
              score: v.score,
              enabled: v.enabled ?? true,
            })
          )
        );
        return true;
      }
      return false;
    },
    [onValuesChange]
  );
  const { modal, handleImport, handleExport } = useImportExport(
    getExportData,
    handleImportData,
    title
  );

  return (
    <SettingsCard
      id={fieldName ?? toId(title)}
      title={title}
      description={description}
    >
      <SortableList rows={rows}>
        {renderRows(
          rows,
          values,
          (v) => v.expression,
          (value, index) => (
            <>
              <div className={rowControlsClass}>
                <div className={rowLeadControlClass}>
                  <Checkbox
                    value={value.enabled ?? true}
                    defaultValue={true}
                    size="lg"
                    aria-label="Enabled"
                    onValueChange={(v) => {
                      if (onEnabledChange) {
                        onEnabledChange(v === true, index);
                      }
                    }}
                  />
                </div>
                <div className={rowActionsClass}>
                  <ItemActions rows={rows} index={index} />
                </div>
              </div>
              <div className="md:flex-[3]">
                <TextInput
                  value={value.expression}
                  aria-label="Expression"
                  placeholder="addon(type(streams, 'debrid'), 'TorBox')"
                  disabled={value.enabled === false}
                  onValueChange={(newValue) =>
                    onExpressionChange(newValue, index)
                  }
                />
              </div>
              <div className={scoreFieldClass}>
                <NumberInput
                  value={value.score || 0}
                  defaultValue={0}
                  aria-label="Score"
                  disabled={value.enabled === false}
                  onValueChange={(newValue) =>
                    onScoreChange(newValue || 0, index)
                  }
                  min={-1_000_000}
                  max={1_000_000}
                  step={50}
                />
              </div>
            </>
          ),
          { syncEnabled: !!syncConfig }
        )}
      </SortableList>
      <ListFooter
        onAdd={() =>
          onValuesChange([
            ...values,
            { expression: '', score: 0, enabled: true },
          ])
        }
        onImportClick={modal.open}
        onExport={handleExport}
      />
      <ImportModal
        open={modal.isOpen}
        onOpenChange={modal.toggle}
        onImport={handleImport}
      />
      {syncConfig && (
        <SyncedUrlInputs syncConfig={syncConfig} renderType="ranked" />
      )}
    </SettingsCard>
  );
}

// RankedRegexInputs

export interface RankedRegexInputProps {
  title: string;
  description: string;
  values: NonNullable<UserData['rankedRegexPatterns']>;
  onValuesChange: (
    values: NonNullable<UserData['rankedRegexPatterns']>
  ) => void;
  onPatternChange: (pattern: string, index: number) => void;
  onNameChange: (name: string, index: number) => void;
  onScoreChange: (score: number, index: number) => void;
  syncConfig?: SyncConfig;
}

export function RankedRegexInputs({
  title,
  description,
  values,
  onValuesChange,
  onPatternChange,
  onNameChange,
  onScoreChange,
  syncConfig,
}: RankedRegexInputProps) {
  const valuesRef = useRef(values);
  valuesRef.current = values;

  const rows = useSortableRows(values, onValuesChange);

  const getExportData = useCallback(
    () =>
      valuesRef.current.map((v) => ({
        pattern: v.pattern,
        name: v.name,
        score: v.score,
      })),
    []
  );
  const handleImportData = useCallback(
    (data: any) => {
      if (
        Array.isArray(data) &&
        data.every(
          (v: any) =>
            typeof v.pattern === 'string' && typeof v.score === 'number'
        )
      ) {
        onValuesChange(
          data.map((v: any) => ({
            pattern: v.pattern,
            name: v.name,
            score: v.score,
          }))
        );
        return true;
      }
      return false;
    },
    [onValuesChange]
  );
  const { modal, handleImport, handleExport } = useImportExport(
    getExportData,
    handleImportData,
    title
  );

  return (
    <SettingsCard title={title} description={description}>
      <SortableList rows={rows}>
        {renderRows(
          rows,
          values,
          (v) => v.pattern,
          (value, index) => (
            <>
              <div className={rowActionsClass}>
                <ItemActions rows={rows} index={index} />
              </div>
              <div className="md:flex-[3]">
                <TextInput
                  value={value.pattern}
                  aria-label="Pattern"
                  placeholder="Regex Pattern"
                  onValueChange={(newValue) => onPatternChange(newValue, index)}
                />
              </div>
              <div className="md:flex-[2]">
                <TextInput
                  value={value.name || ''}
                  aria-label="Name"
                  placeholder="Name (Optional)"
                  onValueChange={(newValue) => onNameChange(newValue, index)}
                />
              </div>
              <div className={scoreFieldClass}>
                <NumberInput
                  value={value.score}
                  aria-label="Score"
                  onValueChange={(newValue) =>
                    onScoreChange(newValue ?? 0, index)
                  }
                  min={-1_000_000}
                  max={1_000_000}
                  step={50}
                />
              </div>
            </>
          ),
          { syncEnabled: !!syncConfig, iconPosition: 'inside' }
        )}
      </SortableList>
      <ListFooter
        onAdd={() =>
          onValuesChange([...values, { pattern: '', name: '', score: 0 }])
        }
        onImportClick={modal.open}
        onExport={handleExport}
      />
      <ImportModal
        open={modal.isOpen}
        onOpenChange={modal.toggle}
        onImport={handleImport}
      />
      {syncConfig && (
        <SyncedUrlInputs syncConfig={syncConfig} renderType="ranked" />
      )}
    </SettingsCard>
  );
}
