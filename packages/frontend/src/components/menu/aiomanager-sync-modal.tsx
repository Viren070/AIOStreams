import React from 'react';
import { Button } from '@/components/ui/button';
import { TextInput } from '@/components/ui/text-input';
import { PasswordInput } from '@/components/ui/password-input';
import { Select } from '@/components/ui/select';
import { Modal } from '@/components/ui/modal';
import { toast } from 'sonner';
import { checkAIOManagerStatus, syncToAIOManager } from '@/lib/api';

const CUSTOM_INSTANCE = 'custom';

/** Instances whose operators publish them for open use. */
const PUBLIC_INSTANCES: { name: string; url: string }[] = [
  { name: 'Elfhosted', url: 'https://aiomanager.elfhosted.com' },
  { name: 'IbbyLabs', url: 'https://aiomanager.ibbylabs.dev' },
  { name: 'Kuu', url: 'https://aiomanager.stremio.ru' },
  { name: 'Midnight', url: 'https://aiomanagerfortheweebs.midnightignite.me' },
  { name: 'Yeb', url: 'https://aiomanager.fortheweak.cloud' },
  { name: 'Kuu (beta)', url: 'https://aiomanager-beta.stremio.ru' },
  { name: 'Yeb (beta)', url: 'https://aiomanager-beta.fortheweak.cloud' },
];

/** The last instance used, so only the key has to be retyped. Never the key. */
const INSTANCE_STORAGE_KEY = 'aiostreams-aiomanager-instance';

type Support = 'unknown' | 'checking' | 'yes' | 'no';

interface AIOManagerSyncModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  manifestUrl: string;
}

export function AIOManagerSyncModal({
  open,
  onOpenChange,
  manifestUrl,
}: AIOManagerSyncModalProps) {
  const [selectedInstance, setSelectedInstance] =
    React.useState<string>(CUSTOM_INSTANCE);
  const [customUrl, setCustomUrl] = React.useState('');
  const [apiKey, setApiKey] = React.useState('');
  const [isSyncing, setIsSyncing] = React.useState(false);
  const [support, setSupport] = React.useState<Support>('unknown');
  const [instanceSupport, setInstanceSupport] = React.useState<
    Record<string, boolean>
  >({});

  React.useEffect(() => {
    if (!open) return;
    let remembered: string | null = null;
    try {
      remembered = window.localStorage.getItem(INSTANCE_STORAGE_KEY);
    } catch {
      // Storage can be unavailable; the form simply starts empty.
    }
    if (!remembered) return;
    const listed = PUBLIC_INSTANCES.find((i) => i.url === remembered);
    setSelectedInstance(listed ? listed.url : CUSTOM_INSTANCE);
    if (!listed) setCustomUrl(remembered);
  }, [open]);

  // Which listed instances have updated far enough to accept a sync. There is
  // no registry of that, so each one is asked directly.
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    Promise.all(
      PUBLIC_INSTANCES.map(async (instance) => {
        try {
          const status = await checkAIOManagerStatus(instance.url);
          return [instance.url, status.supported] as const;
        } catch {
          return [instance.url, false] as const;
        }
      })
    ).then((pairs) => {
      if (!cancelled) setInstanceSupport(Object.fromEntries(pairs));
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const effectiveUrl = (
    selectedInstance === CUSTOM_INSTANCE ? customUrl : selectedInstance
  )
    .trim()
    .replace(/\/+$/, '');

  React.useEffect(() => {
    if (!open || !effectiveUrl) {
      setSupport('unknown');
      return;
    }
    let cancelled = false;
    setSupport('checking');
    const timer = setTimeout(() => {
      checkAIOManagerStatus(effectiveUrl)
        .then((status) => {
          if (!cancelled) setSupport(status.supported ? 'yes' : 'no');
        })
        .catch(() => {
          if (!cancelled) setSupport('unknown');
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, effectiveUrl]);

  const handleSync = async () => {
    const key = apiKey.trim();
    if (!effectiveUrl || !key) {
      toast.error('Enter your AIOManager instance URL and API key.');
      return;
    }
    setIsSyncing(true);
    try {
      await syncToAIOManager({
        instanceUrl: effectiveUrl,
        apiKey: key,
        addonUrl: manifestUrl,
      });
      try {
        window.localStorage.setItem(INSTANCE_STORAGE_KEY, effectiveUrl);
      } catch {
        // Not remembering the instance is not worth failing the sync over.
      }
      toast.success('Addon synced to AIOManager');
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to sync to AIOManager'
      );
    } finally {
      setIsSyncing(false);
    }
  };

  const instanceOptions = [
    ...PUBLIC_INSTANCES.map((instance) => ({
      value: instance.url,
      label:
        instanceSupport[instance.url] === false
          ? `${instance.name} — no Hydra API`
          : instance.name,
    })),
    { value: CUSTOM_INSTANCE, label: 'Custom instance' },
  ];

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Sync to AIOManager"
      description="Install or update this addon in your AIOManager account and propagate it to your connected platforms."
    >
      <div className="flex flex-col gap-4">
        <Select
          label="Instance"
          value={selectedInstance}
          onValueChange={setSelectedInstance}
          options={instanceOptions}
        />

        {selectedInstance === CUSTOM_INSTANCE && (
          <TextInput
            label="Instance URL"
            placeholder="https://aio.example.com"
            value={customUrl}
            onValueChange={setCustomUrl}
          />
        )}

        <PasswordInput
          label="API key"
          help="AIOManager: Accounts → Connections → API key"
          value={apiKey}
          onValueChange={setApiKey}
        />

        {support === 'no' && (
          <p className="text-xs text-amber-300">
            This instance does not serve the Hydra API, so it cannot accept a
            sync. It needs a newer AIOManager release.
          </p>
        )}
        {support === 'checking' && (
          <p className="text-xs text-gray-400">Checking this instance…</p>
        )}

        <Button
          onClick={handleSync}
          intent="primary"
          loading={isSyncing}
          disabled={support === 'no' || !effectiveUrl || !apiKey.trim()}
        >
          Sync
        </Button>
      </div>
    </Modal>
  );
}
