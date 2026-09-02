import React from 'react';
import { Select } from '@/components/ui/select';
import { TextInput } from '@/components/ui/text-input';
import { PasswordInput } from '@/components/ui/password-input';
import type { PlatformDescriptor, PlatformField } from '@aiostreams/core';

export interface PlatformCredentialState {
  mode: string;
  values: Record<string, string>;
}

export function initialCredentialState(
  platform: PlatformDescriptor
): PlatformCredentialState {
  return { mode: platform.authMethods[0]?.id ?? '', values: {} };
}

function activeFields(
  platform: PlatformDescriptor,
  state: PlatformCredentialState
): PlatformField[] {
  const method = platform.authMethods.find((m) => m.id === state.mode);
  return [...(platform.commonFields ?? []), ...(method?.fields ?? [])];
}

/** The `input` object `POST /linked-accounts` expects, built from the descriptor. */
export function platformLinkInput(
  platform: PlatformDescriptor,
  state: PlatformCredentialState
): Record<string, unknown> {
  const input: Record<string, unknown> = { mode: state.mode };
  for (const field of activeFields(platform, state)) {
    input[field.key] = (state.values[field.key] ?? '').trim();
  }
  return input;
}

export function platformCredentialsComplete(
  platform: PlatformDescriptor,
  state: PlatformCredentialState
): boolean {
  return activeFields(platform, state).every(
    (field) => field.optional || (state.values[field.key] ?? '').trim()
  );
}

interface PlatformCredentialFieldsProps {
  platform: PlatformDescriptor;
  value: PlatformCredentialState;
  onChange: (value: PlatformCredentialState) => void;
}

/**
 * Renders whatever a platform says it needs. Nothing here knows about any
 * particular platform, so adding one is a driver change alone.
 */
export function PlatformCredentialFields({
  platform,
  value,
  onChange,
}: PlatformCredentialFieldsProps) {
  const method = platform.authMethods.find((m) => m.id === value.mode);

  const set = (key: string, next: string) =>
    onChange({ ...value, values: { ...value.values, [key]: next } });

  const renderField = (field: PlatformField) => {
    const shared = {
      key: field.key,
      label: field.label,
      help: field.help,
      placeholder: field.placeholder,
      value: value.values[field.key] ?? '',
      onValueChange: (next: string) => set(field.key, next),
    };
    return field.type === 'password' ? (
      <PasswordInput {...shared} />
    ) : (
      <TextInput {...shared} type={field.type === 'email' ? 'email' : 'text'} />
    );
  };

  return (
    <>
      {(platform.commonFields ?? []).map(renderField)}
      {/* A single way in needs no choosing. */}
      {platform.authMethods.length > 1 && (
        <Select
          label="Sign in with"
          value={value.mode}
          onValueChange={(mode) =>
            onChange({ ...value, mode, values: value.values })
          }
          options={platform.authMethods.map((method) => ({
            value: method.id,
            label: method.label,
          }))}
        />
      )}
      {(method?.fields ?? []).map(renderField)}
      {method?.note && <p className="text-xs text-gray-500">{method.note}</p>}
    </>
  );
}
