import React from 'react';
import { toast } from 'sonner';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { useImportEnv, type SettingsKey } from '../queries';
import { humanise } from '../tabs.config';

const SECRET_PREVIEW = '••••••';

function previewValue(v: unknown, secret: boolean): string {
  if (secret) return SECRET_PREVIEW;
  if (v === null) return 'null';
  if (v === undefined) return '—';
  if (typeof v === 'string') return v === '' ? '""' : v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    const json = JSON.stringify(v);
    return json.length > 60 ? json.slice(0, 57) + '…' : json;
  } catch {
    return String(v);
  }
}

/**
 * Modal that previews every env-overridden runtime config key and offers to
 * persist them into the DB. After running, the env vars must be removed from
 * the deployment for the persisted values to actually take effect.
 */
export function ImportEnvModal({
  open,
  onOpenChange,
  envKeys,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  envKeys: SettingsKey[];
}) {
  const { mutateAsync, isPending } = useImportEnv();

  const grouped = React.useMemo(() => {
    const m = new Map<string, SettingsKey[]>();
    for (const k of envKeys) {
      const section = k.key.split('.')[0];
      if (!m.has(section)) m.set(section, []);
      m.get(section)!.push(k);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [envKeys]);

  const onConfirm = async () => {
    try {
      const res = await mutateAsync();
      toast.success(
        `Imported ${res.imported.length} setting${res.imported.length === 1 ? '' : 's'} into the database.`
      );
      if (res.skippedAsDefault.length) {
        toast.info(
          `Skipped ${res.skippedAsDefault.length} that already match the default.`
        );
      }
      if (res.failed.length) {
        toast.warning(
          `${res.failed.length} could not be imported. Check logs.`
        );
      }
      if (res.imported.length) {
        toast.warning(
          'Remove the corresponding env vars and restart for these to take effect.',
          { duration: 10000 }
        );
      }
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to import env settings');
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Import environment variables into the database"
      description={
        envKeys.length === 0
          ? 'No environment-pinned settings found.'
          : 'Copies the current value of every env-set setting into the database. Values that already match the schema default are skipped automatically.'
      }
      contentClass="max-w-2xl"
      footer={
        <>
          <Button
            intent="gray-basic"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            intent="primary-subtle"
            onClick={onConfirm}
            loading={isPending}
            disabled={isPending || envKeys.length === 0}
          >
            Import {envKeys.length} {envKeys.length === 1 ? 'key' : 'keys'}
          </Button>
        </>
      }
    >
      {envKeys.length > 0 && (
        <div className="space-y-3">
          <Alert
            intent="info"
            description={
              <>
                Environment variables always override database values. After
                importing, you must remove the matching env vars from your
                deployment <em>and restart</em> for the persisted values to take
                effect - otherwise the env still overrides.
              </>
            }
            isClosable={false}
          />

          <div className="max-h-[50vh] overflow-y-auto space-y-4 pr-1">
            {grouped.map(([section, list]) => (
              <div key={section}>
                <div className="text-xs font-semibold text-[--muted] uppercase tracking-wide mb-1.5">
                  {humanise(section)}
                </div>
                <ul className="space-y-1">
                  {list.map((k) => (
                    <li
                      key={k.key}
                      className="flex items-start justify-between gap-3 py-1.5 px-2 rounded-md hover:bg-[--subtle] transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 min-w-0">
                          <span className="font-medium break-words">
                            {k.label}
                          </span>
                          {k.env && (
                            <code className="text-xs text-[--muted] break-all min-w-0">
                              {k.env}
                            </code>
                          )}
                        </div>
                        <div className="text-xs text-[--muted] break-all mt-0.5 font-mono min-w-0">
                          {previewValue(k.value, k.secret)}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
