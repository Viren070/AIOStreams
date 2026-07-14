import React from 'react';
import { BiLockAlt, BiTrash } from 'react-icons/bi';
import { useFormContext } from 'react-hook-form';
import { Field } from '@/components/ui/form';
import { BasicField } from '@/components/ui/basic-field';
import { PasswordInput } from '@/components/ui/password-input';
import { Tooltip } from '@/components/ui/tooltip';
import { IconButton } from '@/components/ui/button';
import type { SettingsKey } from '../queries';
import {
  KeyValueListField,
  StringListField,
  JsonField,
  BoolOrListField,
  MultilineStringField,
  DurationField,
  SizeField,
  SECRET_CLEAR_SENTINEL,
  md,
} from './custom-fields';

export { SECRET_CLEAR_SENTINEL };

/** dotted config key → react-hook-form-safe flat name (no dots/brackets). */
export const toName = (key: string) => key.replace(/\./g, '--');

/** Single-line password field with an optional "Clear" button when a secret is already set. */
function SecretTextField({
  name,
  label,
  help,
  secretSet,
  disabled,
}: {
  name: string;
  label: React.ReactNode;
  help?: string;
  secretSet: boolean;
  disabled?: boolean;
}) {
  const { setValue, watch } = useFormContext();
  const value = watch(name);
  const isClearing = value === SECRET_CLEAR_SENTINEL;
  return (
    <BasicField
      label={label}
      help={md(
        isClearing
          ? `${help ? help + ' · ' : ''}Will be cleared on save.`
          : help
      )}
    >
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <PasswordInput
            value={isClearing ? '' : (value ?? '')}
            placeholder={
              isClearing
                ? '(will be cleared)'
                : secretSet
                  ? '•••••••• (unchanged)'
                  : ''
            }
            disabled={disabled || isClearing}
            onValueChange={(v) => setValue(name, v, { shouldDirty: true })}
          />
        </div>
        {secretSet && !disabled && (
          <Tooltip
            trigger={
              <IconButton
                size="sm"
                intent={isClearing ? 'alert-subtle' : 'gray-subtle'}
                icon={<BiTrash />}
                aria-label={isClearing ? 'Cancel clear' : 'Clear secret value'}
                onClick={() =>
                  setValue(name, isClearing ? '' : SECRET_CLEAR_SENTINEL, {
                    shouldDirty: true,
                  })
                }
              />
            }
          >
            {isClearing ? 'Cancel — keep current value' : 'Clear saved value'}
          </Tooltip>
        )}
      </div>
    </BasicField>
  );
}

function LockBadge({ env }: { env: string }) {
  return (
    <Tooltip trigger={<BiLockAlt className="inline text-[--muted]" />}>
      Set by environment variable: <code>{env}</code>
    </Tooltip>
  );
}

/**
 * Renders one config key into the appropriate Field.* based on the
 * server-provided UI hint + metadata. Env-overridden fields are read-only
 * with a lock badge (the effective value is shown, not hidden).
 */
export function SettingsField({ k }: { k: SettingsKey }) {
  const name = toName(k.key);
  const envLocked = k.source === 'environment';
  const disabled = envLocked;
  const labelNode = (
    <span className="inline-flex items-center gap-1.5">
      {k.label}
      {envLocked && k.env && <LockBadge env={k.env} />}
    </span>
  );
  const help = k.description || undefined;

  if (k.secret) {
    const secretHelp = k.secretSet
      ? `${help ? help + ' · ' : ''}A value is set. Type to replace it, or clear it.`
      : help;
    // Multi-line secrets (e.g. env-style credential maps) need a textarea —
    // a single-line password input mangles newlines and hides everything
    // behind dots which is unusable for this format. We accept the
    // weakened on-screen masking as the right trade-off here.
    if (k.ui.multiline) {
      return (
        <MultilineStringField
          name={name}
          label={k.label}
          help={secretHelp}
          disabled={disabled}
          secretSet={k.secretSet}
        />
      );
    }
    return (
      <SecretTextField
        name={name}
        label={labelNode as unknown as string}
        help={secretHelp}
        secretSet={k.secretSet}
        disabled={disabled}
      />
    );
  }

  switch (k.ui.kind) {
    case 'boolean':
      return (
        <Field.Switch
          name={name}
          label={labelNode as unknown as string}
          help={md(help)}
          side="right"
          disabled={disabled}
        />
      );
    case 'number':
      return (
        <Field.Number
          name={name}
          label={labelNode as unknown as string}
          help={md(help)}
          disabled={disabled}
          min={k.ui.min}
        />
      );
    case 'enum':
      return (
        <Field.Select
          name={name}
          label={labelNode as unknown as string}
          help={md(help)}
          disabled={disabled}
          options={(k.ui.options ?? []).map((o) => ({ label: o, value: o }))}
        />
      );
    case 'list':
      return (
        <StringListField
          name={name}
          label={k.label}
          help={help}
          disabled={disabled}
        />
      );
    case 'map':
      return (
        <KeyValueListField
          name={name}
          label={k.label}
          help={help}
          disabled={disabled}
          valueKind={k.ui.mapValueKind ?? 'string'}
          width={k.ui.mapWidth ?? 'equal'}
          min={k.ui.min}
        />
      );
    case 'duration':
      return (
        <DurationField
          name={name}
          label={k.label}
          help={help}
          disabled={disabled}
        />
      );
    case 'size':
      return (
        <SizeField
          name={name}
          label={k.label}
          help={help}
          disabled={disabled}
        />
      );
    case 'boolOrList':
      return (
        <BoolOrListField
          name={name}
          label={k.label}
          help={help}
          disabled={disabled}
        />
      );
    case 'json':
      return (
        <JsonField
          name={name}
          label={k.label}
          help={help}
          disabled={disabled}
        />
      );
    case 'string':
    default:
      if (k.ui.multiline) {
        return (
          <MultilineStringField
            name={name}
            label={k.label}
            help={help}
            disabled={disabled}
          />
        );
      }
      return (
        <Field.Text
          name={name}
          label={labelNode as unknown as string}
          help={md(help)}
          disabled={disabled}
        />
      );
  }
}
