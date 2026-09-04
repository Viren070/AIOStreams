import React from 'react';
import { toast } from 'sonner';
import {
  BiPlus,
  BiTrash,
  BiCheckCircle,
  BiErrorCircle,
  BiTestTube,
} from 'react-icons/bi';
import { Card } from '@/components/ui/card';
import { Button, IconButton } from '@/components/ui/button';
import { TextInput } from '@/components/ui/text-input';
import { PasswordInput } from '@/components/ui/password-input';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { BasicField } from '@/components/ui/basic-field';
import { cn } from '@/components/ui/core/styling';
import { Spinner } from '@/components/ui/loading-spinner';
import {
  ARR_SECRET_MASK,
  useArrInstances,
  useSaveArrInstances,
  useTestArrInstance,
  type MaskedArrInstance,
  type ArrTestResult,
} from '../queries';
import { useSettingsPanelField } from './settings-panels';
import { StringListField } from './custom-fields';

/** Client-side editable instance row. */
interface Draft {
  id: string;
  name: string;
  type: 'sonarr' | 'radarr';
  url: string;
  /** Empty string means "unchanged" when {@link Draft.hasApiKey}. */
  apiKey: string;
  hasApiKey: boolean;
  enabled: boolean;
  /** Download-client categories this instance owns; empty = any. */
  categories: string[];
}

function makeId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `a_${Math.random().toString(36).slice(2)}`
  );
}

function fromMasked(i: MaskedArrInstance): Draft {
  return {
    id: i.id,
    name: i.name ?? '',
    type: i.type,
    url: i.url,
    apiKey: '',
    hasApiKey: i.hasApiKey,
    enabled: i.enabled !== false,
    categories: i.categories ?? [],
  };
}

function toPayload(d: Draft) {
  return {
    id: d.id,
    name: d.name.trim() || undefined,
    type: d.type,
    url: d.url.trim(),
    // An untouched key round-trips as the mask so secrets never leave the server.
    apiKey: d.apiKey ? d.apiKey : d.hasApiKey ? ARR_SECRET_MASK : '',
    enabled: d.enabled,
    categories: d.categories.map((c) => c.trim()).filter(Boolean),
  };
}

function Pill({
  intent,
  children,
}: {
  intent: 'success' | 'alert';
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        intent === 'success'
          ? 'bg-emerald-500/15 text-emerald-500'
          : 'bg-red-500/15 text-red-400'
      )}
    >
      {children}
    </span>
  );
}

/**
 * Sonarr/Radarr instances AIOStreams may call back: to refresh their queue the
 * moment a download completes, and to replace a release the library recheck
 * found dead. Saved through its own endpoint (the list holds API keys, so it
 * is not part of the generic settings form).
 */
export function ArrInstancesEditor() {
  const query = useArrInstances();
  const save = useSaveArrInstances();
  const test = useTestArrInstance();
  const [results, setResults] = React.useState<
    Record<string, ArrTestResult | 'pending'>
  >({});

  const {
    name,
    value: drafts,
    setValue: setDrafts,
    seed,
  } = useSettingsPanelField<Draft[]>('arr.instances', {
    save: async (value) => {
      const res = await save.mutateAsync((value as Draft[]).map(toPayload));
      const n = res.instances.length;
      return {
        message: `${n} Sonarr/Radarr instance${n === 1 ? '' : 's'}`,
        value: res.instances.map(fromMasked),
      };
    },
  });

  // Publish the server's list as the field's default the first time it lands.
  React.useEffect(() => {
    if (drafts === undefined && query.data) {
      seed(query.data.instances.map(fromMasked));
    }
  }, [query.data, drafts, seed]);

  if (query.isLoading || drafts === undefined) {
    return (
      <Card className="p-6 flex justify-center">
        <Spinner className="w-6 h-6" />
      </Card>
    );
  }
  if (query.isError) {
    return (
      <Card className="p-6 text-sm text-red-400">
        Failed to load Sonarr/Radarr instances.
      </Card>
    );
  }

  const patch = (id: string, next: Partial<Draft>) =>
    setDrafts(drafts.map((d) => (d.id === id ? { ...d, ...next } : d)));

  const add = () =>
    setDrafts([
      ...drafts,
      {
        id: makeId(),
        name: '',
        type: 'sonarr',
        url: '',
        apiKey: '',
        hasApiKey: false,
        enabled: true,
        categories: [],
      },
    ]);

  const onTest = async (d: Draft) => {
    setResults((r) => ({ ...r, [d.id]: 'pending' }));
    try {
      const res = await test.mutateAsync(toPayload(d));
      setResults((r) => ({ ...r, [d.id]: res }));
      if (res.ok)
        toast.success(`${res.appName ?? 'Connected'} ${res.version ?? ''}`);
      else toast.error(res.error ?? 'Connection failed');
    } catch (e: any) {
      const res = { ok: false, error: e?.message ?? 'Connection failed' };
      setResults((r) => ({ ...r, [d.id]: res }));
      toast.error(res.error);
    }
  };

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold">Sonarr / Radarr instances</p>
          <p className="text-sm text-[--muted]">
            Optional. Lets AIOStreams nudge an instance to import as soon as a
            grab is ready, and tell it to replace a release the library recheck
            found dead.
          </p>
        </div>
        <Button
          size="sm"
          intent="primary-subtle"
          leftIcon={<BiPlus />}
          onClick={add}
        >
          Add
        </Button>
      </div>

      {drafts.length === 0 && (
        <p className="text-sm text-[--muted]">No instances configured.</p>
      )}

      {drafts.map((d, index) => {
        const result = results[d.id];
        return (
          <Card key={d.id} className="p-4 space-y-3 bg-[--subtle]/30">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Switch
                  value={d.enabled}
                  onValueChange={(v) => patch(d.id, { enabled: v })}
                  label="Enabled"
                />
                {result && result !== 'pending' && (
                  <Pill intent={result.ok ? 'success' : 'alert'}>
                    {result.ok ? <BiCheckCircle /> : <BiErrorCircle />}
                    {result.ok
                      ? `${result.appName ?? 'OK'} ${result.version ?? ''}`.trim()
                      : 'Failed'}
                  </Pill>
                )}
              </div>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  intent="white-subtle"
                  leftIcon={<BiTestTube />}
                  loading={result === 'pending'}
                  onClick={() => onTest(d)}
                >
                  Test
                </Button>
                <IconButton
                  size="sm"
                  intent="alert-subtle"
                  icon={<BiTrash />}
                  onClick={() => setDrafts(drafts.filter((x) => x.id !== d.id))}
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <BasicField label="Name">
                <TextInput
                  value={d.name}
                  placeholder="Sonarr"
                  onValueChange={(v) => patch(d.id, { name: v })}
                />
              </BasicField>
              <BasicField label="Application">
                <Select
                  value={d.type}
                  options={[
                    { value: 'sonarr', label: 'Sonarr' },
                    { value: 'radarr', label: 'Radarr' },
                  ]}
                  onValueChange={(v) =>
                    patch(d.id, { type: v as Draft['type'] })
                  }
                />
              </BasicField>
              <BasicField
                label="URL"
                help="As AIOStreams reaches it, e.g. http://sonarr:8989"
              >
                <TextInput
                  value={d.url}
                  placeholder="http://sonarr:8989"
                  onValueChange={(v) => patch(d.id, { url: v })}
                />
              </BasicField>
              <BasicField
                label="API key"
                help={
                  d.hasApiKey ? 'Stored. Leave blank to keep it.' : undefined
                }
              >
                <PasswordInput
                  value={d.apiKey}
                  placeholder={d.hasApiKey ? '••••••••' : ''}
                  onValueChange={(v) => patch(d.id, { apiKey: v })}
                />
              </BasicField>
              <div className="sm:col-span-2">
                <StringListField
                  name={`${name}.${index}.categories`}
                  label="Categories"
                  help="Download-client categories this instance owns. Leave empty for any."
                />
              </div>
            </div>
          </Card>
        );
      })}
    </Card>
  );
}
