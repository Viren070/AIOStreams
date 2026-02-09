'use client';
import { ReactNode, useCallback, useRef } from 'react';
import { useDisclosure } from '@/hooks/disclosure';
import { toast } from 'sonner';
import { arrayMove } from '@dnd-kit/sortable';
import { IconButton } from '../../../ui/button';
import { TextInput } from '../../../ui/text-input';
import { NumberInput } from '../../../ui/number-input';
import { Tooltip } from '../../../ui/tooltip';
import { Checkbox } from '../../../ui/checkbox';
import { SettingsCard } from '../../../shared/settings-card';
import { ImportModal } from '../../../shared/import-modal';
import { SyncedUrlInputs, type SyncConfig } from './synced-patterns';
import {
  FaPlus,
  FaRegTrashAlt,
  FaFileExport,
  FaFileImport,
  FaArrowUp,
  FaArrowDown,
} from 'react-icons/fa';
import { UserData } from '@aiostreams/core';

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

// Reusable item-list action buttons

interface ItemActionsProps<T> {
  items: T[];
  index: number;
  onItemsChange: (items: T[]) => void;
}

/** Move-up / Move-down / Delete buttons shared by every list item. */
function ItemActions<T>({ items, index, onItemsChange }: ItemActionsProps<T>) {
  return (
    <>
      <IconButton
        size="sm"
        rounded
        icon={<FaArrowUp />}
        intent="primary-subtle"
        disabled={index === 0}
        onClick={() => onItemsChange(arrayMove(items, index, index - 1))}
      />
      <IconButton
        size="sm"
        rounded
        icon={<FaArrowDown />}
        intent="primary-subtle"
        disabled={index === items.length - 1}
        onClick={() => onItemsChange(arrayMove(items, index, index + 1))}
      />
      <IconButton
        size="sm"
        rounded
        icon={<FaRegTrashAlt />}
        intent="alert-subtle"
        onClick={() =>
          onItemsChange([...items.slice(0, index), ...items.slice(index + 1)])
        }
      />
    </>
  );
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
    <SettingsCard title={label} description={help} key={label}>
      {values.map((value, index) => (
        <div key={index} className="flex gap-2">
          <div className="flex-1">
            <TextInput
              value={value}
              label={itemName}
              placeholder={placeholder}
              onValueChange={(newValue) => handleValueChange(newValue, index)}
            />
          </div>
          <div className="flex gap-1 items-end pb-1">
            <ItemActions
              items={values}
              index={index}
              onItemsChange={onValuesChange}
            />
          </div>
        </div>
      ))}
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
      {values.map((value, index) => (
        <div key={index} className="flex gap-2">
          <div className="flex-1">
            <TextInput
              value={value.name}
              label={keyName}
              placeholder={keyPlaceholder}
              onValueChange={(newValue) => onKeyChange(newValue, index)}
            />
          </div>
          <div className="flex-1">
            <TextInput
              value={value.value}
              label={valueName}
              placeholder={valuePlaceholder}
              onValueChange={(newValue) => onValueChange(newValue, index)}
            />
          </div>
          <div className="flex gap-1 items-end pb-1">
            <ItemActions
              items={values}
              index={index}
              onItemsChange={onValuesChange}
            />
          </div>
        </div>
      ))}
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
    <SettingsCard title={title} description={description}>
      {values.map((value, index) => (
        <div key={index} className="flex gap-2 items-start">
          <div className="flex items-center pt-8">
            <Checkbox
              value={value.enabled ?? true}
              defaultValue={true}
              size="lg"
              onValueChange={(v) => {
                if (onEnabledChange) {
                  onEnabledChange(v === true, index);
                }
              }}
            />
          </div>
          <div className="flex-[3]">
            <TextInput
              value={value.expression}
              label="Expression"
              placeholder="addon(type(streams, 'debrid'), 'TorBox')"
              disabled={value.enabled === false}
              onValueChange={(newValue) => onExpressionChange(newValue, index)}
            />
          </div>
          <div className="flex-1 min-w-[100px]">
            <NumberInput
              value={value.score || 0}
              defaultValue={0}
              label="Score"
              disabled={value.enabled === false}
              onValueChange={(newValue) => onScoreChange(newValue || 0, index)}
              min={-1_000_000}
              max={1_000_000}
              step={50}
            />
          </div>
          <div className="flex gap-1 items-end pb-1">
            <ItemActions
              items={values}
              index={index}
              onItemsChange={onValuesChange}
            />
          </div>
          
        </div>
      ))}
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
      {values.map((value, index) => (
        <div
          key={index}
          className="flex flex-col gap-2 p-3 border rounded-md border-[--border]"
        >
          <div className="w-full">
            <TextInput
              value={value.pattern}
              label="Pattern"
              placeholder="Regex Pattern"
              onValueChange={(newValue) => onPatternChange(newValue, index)}
            />
          </div>
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <TextInput
                value={value.name || ''}
                label="Name"
                placeholder="Name (Optional)"
                onValueChange={(newValue) => onNameChange(newValue, index)}
              />
            </div>
            <div className="w-[20%] min-w-[100px]">
              <NumberInput
                value={value.score}
                label="Score"
                onValueChange={(newValue) =>
                  onScoreChange(newValue ?? 0, index)
                }
                min={-1_000_000}
                max={1_000_000}
                step={50}
              />
            </div>
            <div className="flex gap-1 pb-1">
              <ItemActions
                items={values}
                index={index}
                onItemsChange={onValuesChange}
              />
            </div>
          </div>
        </div>
      ))}
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
