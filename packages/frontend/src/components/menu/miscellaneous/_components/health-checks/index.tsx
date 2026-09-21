import React, { useState } from 'react';
import { useUserData } from '@/context/userData';
import { useStatus } from '@/context/status';
import { SettingsCard } from '../../../../shared/settings-card';
import { Button, IconButton } from '@/components/ui/button';
import { TextInput } from '@/components/ui/text-input';
import { NumberInput } from '@/components/ui/number-input';
import { Select } from '@/components/ui/select';
import { Alert } from '@/components/ui/alert';
import { Modal } from '@/components/ui/modal';
import { toast } from 'sonner';
import { FiActivity, FiEdit2, FiPlus, FiTrash2 } from 'react-icons/fi';
import type { UserData } from '@aiostreams/core';
import { testHealthCheck, type HealthCheckResult } from '@/lib/api';

type HealthCheck = NonNullable<UserData['healthChecks']>[number];

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;

const emptyCheck = (existing: HealthCheck[]): HealthCheck => {
  let id = 'check';
  for (let i = 2; existing.some((c) => c.id === id); i++) id = `check-${i}`;
  return { id, url: '' };
};

export function HealthChecks() {
  const { userData, setUserData } = useUserData();
  const { status } = useStatus();
  const settings = status?.settings.healthChecks;

  const checks = userData.healthChecks ?? [];
  const max = settings?.max ?? 5;
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<HealthCheck | null>(null);

  const update = (next: HealthCheck[]) =>
    setUserData((prev) => ({ ...prev, healthChecks: next }));

  const openAdd = () => {
    if (checks.length >= max) {
      toast.error(`This instance allows at most ${max} health checks.`);
      return;
    }
    setDraft(emptyCheck(checks));
    setEditing(checks.length);
  };

  const openEdit = (index: number) => {
    setDraft({ ...checks[index] });
    setEditing(index);
  };

  const commit = () => {
    if (!draft) return;
    if (!ID_PATTERN.test(draft.id)) {
      toast.error(
        'Use 1-32 characters: lowercase letters, digits, "-" or "_".'
      );
      return;
    }
    if (checks.some((c, i) => c.id === draft.id && i !== editing)) {
      toast.error('Another health check already uses this id.');
      return;
    }
    if (!draft.url.trim()) {
      toast.error('A health check needs a URL.');
      return;
    }
    const next = [...checks];
    if (editing !== null && editing < checks.length) next[editing] = draft;
    else next.push(draft);
    update(next);
    setEditing(null);
    setDraft(null);
  };

  if (settings?.access === 'none') {
    return (
      <Alert
        intent="info-basic"
        title="Health checks are disabled"
        description="This instance has turned off health checks."
      />
    );
  }

  if (settings?.access === 'trusted' && !userData.trusted) {
    return (
      <Alert
        intent="info-basic"
        title="Health checks are limited to trusted users"
        description="This instance only lets trusted users define health checks. Ask the instance owner to add you."
      />
    );
  }

  return (
    <div className="space-y-4" id="healthChecks">
      <div className="space-y-3">
        <p className="text-sm text-[--muted]">
          A health check is a URL this instance calls to decide whether
          something is up. Use the result as{' '}
          <code className="text-xs px-1 py-0.5 rounded bg-[--subtle]">
            health(&apos;id&apos;)
          </code>{' '}
          in a variant&apos;s activation condition, a group condition, or any
          stream expression, and drop a service while it is down. Results are
          cached for the interval you set and shared with anyone else checking
          the same URL.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            intent="white"
            rounded
            leftIcon={<FiPlus />}
            onClick={openAdd}
            disabled={checks.length >= max}
          >
            Add health check
          </Button>
          <span className="text-xs text-[--muted]">
            {checks.length} of {max} used
          </span>
        </div>
      </div>

      {checks.map((check, index) => (
        <CheckRow
          key={index}
          check={check}
          onEdit={() => openEdit(index)}
          onDelete={() => update(checks.filter((_, i) => i !== index))}
        />
      ))}

      {checks.length === 0 && (
        <Alert
          intent="info-basic"
          title="No health checks yet"
          description="Add one to let a condition react to whether a service is reachable."
        />
      )}

      <EditModal
        draft={draft}
        limits={settings}
        onChange={setDraft}
        onClose={() => {
          setEditing(null);
          setDraft(null);
        }}
        onSave={commit}
      />
    </div>
  );
}

function CheckRow({
  check,
  onEdit,
  onDelete,
}: {
  check: HealthCheck;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <SettingsCard
      title={check.name || check.id}
      description={check.url}
      action={
        <div className="flex items-center gap-2">
          <IconButton
            size="sm"
            intent="gray-subtle"
            icon={<FiEdit2 />}
            onClick={onEdit}
          />
          <IconButton
            size="sm"
            intent="alert-subtle"
            icon={<FiTrash2 />}
            onClick={onDelete}
          />
        </div>
      }
    >
      <p className="text-xs text-[--muted]">
        Referenced as{' '}
        <span className="font-mono">health(&apos;{check.id}&apos;)</span>
      </p>
    </SettingsCard>
  );
}

function EditModal({
  draft,
  limits,
  onChange,
  onClose,
  onSave,
}: {
  draft: HealthCheck | null;
  limits: { minTtl: number; maxTimeout: number } | undefined;
  onChange: (check: HealthCheck) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const { uuid, password } = useUserData();
  const [result, setResult] = useState<HealthCheckResult | null>(null);
  const [testing, setTesting] = useState(false);

  if (!draft) return null;
  const patch = (values: Partial<HealthCheck>) =>
    onChange({ ...draft, ...values });
  const patchExpect = (values: Partial<NonNullable<HealthCheck['expect']>>) =>
    onChange({ ...draft, expect: { ...draft.expect, ...values } });

  const runTest = async () => {
    if (!uuid) {
      toast.error('Save this configuration before testing a health check.');
      return;
    }
    setTesting(true);
    try {
      setResult(await testHealthCheck(uuid, password, draft));
    } catch (error: any) {
      setResult(null);
      toast.error(error?.message ?? 'Could not run the health check');
    } finally {
      setTesting(false);
    }
  };

  return (
    <Modal open onOpenChange={onClose} title="Health check">
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <TextInput
            label="Id"
            help="Used as health('id') in conditions."
            value={draft.id}
            onValueChange={(value) => patch({ id: value.toLowerCase() })}
          />
          <TextInput
            label="Name"
            help="A label for this list."
            value={draft.name ?? ''}
            onValueChange={(value) => patch({ name: value || undefined })}
          />
        </div>

        <TextInput
          label="URL"
          placeholder="https://status.example.com/api/health"
          value={draft.url}
          onValueChange={(value) => patch({ url: value })}
        />

        <div className="grid gap-3 md:grid-cols-2">
          <Select
            label="Method"
            value={draft.method ?? 'GET'}
            onValueChange={(value) =>
              patch({ method: value as HealthCheck['method'] })
            }
            options={[
              { label: 'GET', value: 'GET' },
              { label: 'HEAD', value: 'HEAD' },
            ]}
          />
          <TextInput
            label="Expected status"
            help="A code (200), a class (2xx) or a range (200-299)."
            placeholder="2xx"
            value={draft.expect?.status ?? ''}
            onValueChange={(value) =>
              patchExpect({ status: value || undefined })
            }
          />
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <TextInput
            label="JSON path"
            help="Optional. A dotted path into a JSON body, e.g. data.status."
            value={draft.expect?.jsonPath ?? ''}
            onValueChange={(value) =>
              patchExpect({ jsonPath: value || undefined })
            }
          />
          <TextInput
            label="Expected value"
            help="Optional. Compared to the value at that path. Leave empty to require any truthy value."
            value={
              draft.expect?.jsonValue === undefined
                ? ''
                : String(draft.expect.jsonValue)
            }
            onValueChange={(value) => {
              if (!value) return patchExpect({ jsonValue: undefined });
              if (value === 'true' || value === 'false') {
                return patchExpect({ jsonValue: value === 'true' });
              }
              const asNumber = Number(value);
              patchExpect({
                jsonValue:
                  value.trim() !== '' && !Number.isNaN(asNumber)
                    ? asNumber
                    : value,
              });
            }}
          />
        </div>

        <TextInput
          label="Body contains"
          help="Optional. Text the response body must contain, ignoring case."
          placeholder="operational"
          value={draft.expect?.bodyContains ?? ''}
          onValueChange={(value) =>
            patchExpect({ bodyContains: value || undefined })
          }
        />

        <div className="grid gap-3 md:grid-cols-3">
          <NumberInput
            label="Interval (seconds)"
            help={`How long a result is reused. Minimum ${limits?.minTtl ?? 60}.`}
            value={draft.ttl ?? 300}
            onValueChange={(value) => patch({ ttl: value || undefined })}
          />
          <NumberInput
            label="Timeout (ms)"
            help={`Maximum ${limits?.maxTimeout ?? 10000}.`}
            value={draft.timeout ?? 3000}
            onValueChange={(value) => patch({ timeout: value || undefined })}
          />
          <Select
            label="If the check fails"
            help="When the request times out or cannot be made at all."
            value={draft.onError ?? 'unhealthy'}
            onValueChange={(value) =>
              patch({ onError: value as HealthCheck['onError'] })
            }
            options={[
              { label: 'Treat as down', value: 'unhealthy' },
              { label: 'Treat as up', value: 'healthy' },
            ]}
          />
        </div>

        {result && (
          <Alert
            intent={result.ok ? 'success-basic' : 'warning-basic'}
            title={result.ok ? 'Healthy' : 'Not healthy'}
            description={[
              result.status ? `HTTP ${result.status}` : null,
              result.error,
              `${result.latencyMs} ms`,
            ]
              .filter(Boolean)
              .join(' · ')}
          />
        )}

        <div className="flex items-center justify-between gap-2">
          <Button
            size="sm"
            intent="white-subtle"
            leftIcon={<FiActivity />}
            onClick={runTest}
            disabled={testing || !draft.url.trim()}
          >
            {testing ? 'Testing...' : 'Test now'}
          </Button>
          <div className="flex items-center gap-2">
            <Button size="sm" intent="primary-subtle" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" intent="primary" onClick={onSave}>
              Save
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
