import React from 'react';
import { toast } from 'sonner';
import { AnimatePresence, motion } from 'motion/react';
import { BiArrowBack } from 'react-icons/bi';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { SimpleDropzone } from '@/components/ui/simple-dropzone';
import { useImportSettings } from '../queries';
import { humanise } from '../tabs.config';

interface ParsedFile {
  /** Keys + values that will actually be sent to the server. */
  settings: Record<string, unknown>;
  /** Secret keys deliberately stripped from the payload (masked in source). */
  maskedSecrets: string[];
  /** Total entries seen in the source file (including filtered secrets). */
  totalEntries: number;
  exportedAt?: string;
  version?: number;
  fileName: string;
}

/**
 * Parse and lightly validate a settings export JSON. Filters out masked
 * secrets (value=null + key in maskedSecretKeys) so the server doesn't try
 * to write null into a non-nullable secret field.
 */
function parseExportFile(text: string, fileName: string): ParsedFile {
  const parsed = JSON.parse(text) as {
    settings?: unknown;
    maskedSecretKeys?: unknown;
    exportedAt?: unknown;
    version?: unknown;
  };
  if (
    !parsed.settings ||
    typeof parsed.settings !== 'object' ||
    Array.isArray(parsed.settings)
  ) {
    throw new Error('File is missing a `settings` object.');
  }
  const masked = new Set(
    Array.isArray(parsed.maskedSecretKeys)
      ? parsed.maskedSecretKeys.filter(
          (k): k is string => typeof k === 'string'
        )
      : []
  );
  const source = parsed.settings as Record<string, unknown>;
  const filtered: Record<string, unknown> = {};
  const maskedSecrets: string[] = [];
  for (const [key, value] of Object.entries(source)) {
    if (masked.has(key) && value === null) {
      maskedSecrets.push(key);
      continue;
    }
    filtered[key] = value;
  }
  return {
    settings: filtered,
    maskedSecrets,
    totalEntries: Object.keys(source).length,
    exportedAt:
      typeof parsed.exportedAt === 'string' ? parsed.exportedAt : undefined,
    version: typeof parsed.version === 'number' ? parsed.version : undefined,
    fileName,
  };
}

function previewValue(v: unknown): string {
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

type Step = 'pick' | 'review';

const stepTransition = {
  initial: { opacity: 0, x: 12 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -12 },
  transition: { duration: 0.18, ease: 'easeOut' as const },
};

export function ImportSettingsModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { mutateAsync, isPending } = useImportSettings();

  const [step, setStep] = React.useState<Step>('pick');
  const [file, setFile] = React.useState<ParsedFile | null>(null);
  const [parseError, setParseError] = React.useState<string | null>(null);

  // Reset state every time the modal closes so the next open starts clean.
  React.useEffect(() => {
    if (!open) {
      setStep('pick');
      setFile(null);
      setParseError(null);
    }
  }, [open]);

  const handleFiles = async (files: File[]) => {
    const f = files[0];
    if (!f) return;
    setParseError(null);
    try {
      const text = await f.text();
      const parsed = parseExportFile(text, f.name);
      setFile(parsed);
      setStep('review');
    } catch (e: any) {
      setParseError(e?.message ?? 'Failed to parse JSON file.');
    }
  };

  // Group preview by top-level section for scannability.
  const grouped = React.useMemo(() => {
    if (!file) return [];
    const m = new Map<string, [string, unknown][]>();
    for (const [key, value] of Object.entries(file.settings)) {
      const section = key.split('.')[0];
      if (!m.has(section)) m.set(section, []);
      m.get(section)!.push([key, value]);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [file]);

  const onConfirm = async () => {
    if (!file) return;
    try {
      const res = await mutateAsync(file.settings);
      toast.success(
        `Imported ${res.imported.length} setting${res.imported.length === 1 ? '' : 's'}.`
      );
      if (res.skipped.length) {
        toast.info(
          `Skipped ${res.skipped.length} (unknown or env-locked keys).`
        );
      }
      if (res.failed.length) {
        toast.warning(
          `${res.failed.length} failed validation. Check logs for details.`
        );
      }
      if (res.requiresRestart) {
        toast.warning('Some changes require a restart to take effect.', {
          duration: 8000,
        });
      }
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to import settings');
    }
  };

  const importableCount = file ? Object.keys(file.settings).length : 0;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Import settings from JSON"
      description={
        step === 'pick'
          ? 'Choose a settings export file to preview and import.'
          : `Reviewing ${file?.fileName ?? ''}`
      }
      contentClass="max-w-2xl"
      footer={
        step === 'pick' ? (
          <Button
            intent="gray-basic"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
        ) : (
          <>
            <Button
              intent="gray-basic"
              leftIcon={<BiArrowBack />}
              onClick={() => {
                setFile(null);
                setStep('pick');
              }}
              disabled={isPending}
            >
              Back
            </Button>
            <Button
              intent="primary-subtle"
              onClick={onConfirm}
              loading={isPending}
              disabled={isPending || importableCount === 0}
            >
              Import {importableCount} {importableCount === 1 ? 'key' : 'keys'}
            </Button>
          </>
        )
      }
    >
      <AnimatePresence mode="wait" initial={false}>
        {step === 'pick' && (
          <motion.div key="pick" {...stepTransition} className="space-y-3">
            <SimpleDropzone
              accept={{ 'application/json': ['.json'] }}
              multiple={false}
              maxFiles={1}
              onValueChange={handleFiles}
              dropzoneText="Click or drag a settings JSON file here"
            />
            {parseError && (
              <Alert
                intent="alert"
                description={parseError}
                isClosable={false}
              />
            )}
            <Alert
              intent="info"
              description="Masked secrets in the file will be skipped automatically - you'll need to re-enter them by hand after the import. Unknown or env-locked keys are reported back."
              isClosable={false}
            />
          </motion.div>
        )}

        {step === 'review' && file && (
          <motion.div key="review" {...stepTransition} className="space-y-3">
            {file.exportedAt && (
              <Alert
                intent="info"
                description={
                  <span>
                    Exported{' '}
                    <span className="font-medium">
                      {new Date(file.exportedAt).toLocaleString()}
                    </span>
                    {file.version !== undefined && ` · v${file.version}`} ·{' '}
                    {file.totalEntries} total entr
                    {file.totalEntries === 1 ? 'y' : 'ies'} in source.
                  </span>
                }
                isClosable={false}
              />
            )}

            {file.maskedSecrets.length > 0 && (
              <Alert
                intent="warning"
                title={`${file.maskedSecrets.length} masked secret${file.maskedSecrets.length === 1 ? '' : 's'} skipped`}
                description={
                  <span>
                    You&apos;ll need to enter these manually after the import:{' '}
                    <span className="font-mono text-xs">
                      {file.maskedSecrets.slice(0, 5).join(', ')}
                      {file.maskedSecrets.length > 5 &&
                        ` and ${file.maskedSecrets.length - 5} more`}
                    </span>
                  </span>
                }
                isClosable={false}
              />
            )}

            {importableCount === 0 ? (
              <Alert
                intent="alert"
                description="Nothing to import - the file contains no values that can be applied (everything was either a masked secret or empty)."
                isClosable={false}
              />
            ) : (
              <div className="max-h-[40vh] overflow-y-auto space-y-4 pr-1">
                {grouped.map(([section, entries]) => (
                  <div key={section}>
                    <div className="text-xs font-semibold text-[--muted] uppercase tracking-wide mb-1.5">
                      {humanise(section)}
                    </div>
                    <ul className="space-y-1">
                      {entries.map(([key, value]) => (
                        <li
                          key={key}
                          className="flex items-start gap-3 py-1.5 px-2 rounded-md hover:bg-[--subtle] transition-colors"
                        >
                          <div className="min-w-0 flex-1">
                            <code className="text-xs text-[--muted] break-all block">
                              {key}
                            </code>
                            <div className="text-xs text-[--foreground] break-all mt-0.5 font-mono min-w-0">
                              {previewValue(value)}
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </Modal>
  );
}
