import React from 'react';
import { z } from 'zod';
import { toast } from 'sonner';
import { BiCopy, BiLinkAlt } from 'react-icons/bi';
import { Modal } from '@aiostreams/ui/modal';
import { Button, IconButton } from '@aiostreams/ui/button';
import { Form, Field } from '@aiostreams/ui/form';
import { KeyValueListField } from '../../settings/_components/custom-fields';
import { copyToClipboard } from '@aiostreams/ui/utils/clipboard';
import { useGenerateProxyLink } from '../queries';

const HISTORY_KEY = 'aiostreams.proxy.generated';
const MAX_HISTORY = 20;

const schema = z.object({
  url: z.string(),
  filename: z.any(),
  requestHeaders: z.any(),
  responseHeaders: z.any(),
  type: z.any(),
  encrypt: z.any(),
});

function copy(value: string) {
  copyToClipboard(value, {
    onSuccess: () => toast.success('Copied to clipboard'),
    onError: () => toast.error('Failed to copy to clipboard'),
  });
}

/**
 * Wrap an arbitrary URL in a built-in proxy link. Generated links embed the
 * operator's proxy credentials, so they are kept in `localStorage` only.
 */
export function GenerateProxyLinkModal() {
  const [open, setOpen] = React.useState(false);
  const [result, setResult] = React.useState<string | null>(null);
  const generate = useGenerateProxyLink();
  const [history, setHistory] = React.useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    } catch {
      return [];
    }
  });

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setResult(null);
      }}
      title="Generate proxy link"
      trigger={
        <Button intent="primary-subtle" size="sm" leftIcon={<BiLinkAlt />}>
          Generate proxy link
        </Button>
      }
    >
      <Form
        schema={schema}
        defaultValues={{
          url: '',
          filename: '',
          requestHeaders: {},
          responseHeaders: {},
          type: 'stream',
          encrypt: true,
        }}
        onSubmit={async (data: any) => {
          if (!data.url?.trim()) {
            toast.error('URL is required');
            return;
          }
          try {
            const res = await generate.mutateAsync({
              url: data.url.trim(),
              filename: data.filename || undefined,
              requestHeaders: Object.keys(data.requestHeaders || {}).length
                ? data.requestHeaders
                : undefined,
              responseHeaders: Object.keys(data.responseHeaders || {}).length
                ? data.responseHeaders
                : undefined,
              type: data.type || 'stream',
              encrypt: data.encrypt !== false,
            });
            setResult(res.proxified_url);
            const next = [res.proxified_url, ...history].slice(0, MAX_HISTORY);
            setHistory(next);
            localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
          } catch (e: any) {
            toast.error(e?.message ?? 'Failed to generate');
          }
        }}
      >
        {() => (
          <div className="space-y-3">
            <Field.Text name="url" label="URL" placeholder="https://…" />
            <Field.Text name="filename" label="Filename (optional)" />
            <KeyValueListField
              name="requestHeaders"
              label="Request headers"
              valueKind="string"
            />
            <KeyValueListField
              name="responseHeaders"
              label="Response headers"
              valueKind="string"
            />
            <Field.Select
              name="type"
              label="Type"
              options={[
                { label: 'Stream', value: 'stream' },
                { label: 'NZB', value: 'nzb' },
              ]}
            />
            <Field.Switch name="encrypt" label="Encrypt payload" side="right" />
            <Field.Submit loading={generate.isPending}>Generate</Field.Submit>
          </div>
        )}
      </Form>

      {result && (
        <div className="mt-4 flex items-center gap-2 rounded-lg bg-[--subtle] p-3">
          <code className="flex-1 break-all text-xs">{result}</code>
          <Button
            size="sm"
            intent="gray-outline"
            leftIcon={<BiCopy />}
            onClick={() => copy(result)}
          >
            Copy
          </Button>
        </div>
      )}

      {history.length > 0 && (
        <div className="mt-4">
          <p className="mb-1 text-xs text-[--muted]">Recent (this browser)</p>
          <ul className="max-h-40 space-y-1 overflow-auto">
            {history.map((h, i) => (
              <li key={i} className="flex items-center gap-2">
                <code className="flex-1 break-all text-[10px] text-[--muted]">
                  {h}
                </code>
                <IconButton
                  size="sm"
                  intent="gray-subtle"
                  icon={<BiCopy />}
                  aria-label="Copy link"
                  onClick={() => copy(h)}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}
