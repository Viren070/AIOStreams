import React from 'react';
import { z } from 'zod';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';
import { BiCopy, BiLinkAlt } from 'react-icons/bi';
import { PageWrapper } from '@/components/shared/page-wrapper';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Form, Field } from '@/components/ui/form';
import { cn } from '@/components/ui/core/styling';
import { DashboardQueryBoundary } from '@/components/shared/dashboard-query-boundary';
import { KeyValueListField } from '../settings/_components/custom-fields';
import { copyToClipboard } from '@/utils/clipboard';

interface Conn {
  ip: string;
  url: string;
  filename?: string;
  timestamp: number;
  lastSeen: number;
  count: number;
}
interface ProxyStats {
  users: Array<{ username: string; active: Conn[]; history: Conn[] }>;
  summary: {
    totalActiveConnections: number;
    totalHistoryConnections: number;
    usersWithActiveConnections: number;
    usersWithHistory: number;
  };
}

async function rawGet<T>(path: string): Promise<T> {
  const r = await fetch(`/api/v1${path}`, { credentials: 'include' });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json() as Promise<T>;
}
async function rawPost<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`/api/v1${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok)
    throw new Error(
      (j as any)?.error?.message || (j as any)?.detail || `${r.status}`
    );
  return j as T;
}

const rel = (ms: number) => {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};

const HIST_KEY = 'aiostreams.proxy.generated';

function GenerateModal() {
  const [open, setOpen] = React.useState(false);
  const [result, setResult] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [history, setHistory] = React.useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(HIST_KEY) || '[]');
    } catch {
      return [];
    }
  });

  const schema = React.useMemo(
    () =>
      z.object({
        url: z.string(),
        filename: z.any(),
        requestHeaders: z.any(),
        responseHeaders: z.any(),
        type: z.any(),
        encrypt: z.any(),
      }),
    []
  );

  return (
    <Modal
      open={open}
      onOpenChange={setOpen}
      title="Generate proxy link"
      trigger={
        <Button intent="primary" size="sm" leftIcon={<BiLinkAlt />}>
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
          if (!data.url) {
            toast.error('URL is required');
            return;
          }
          setBusy(true);
          try {
            const res = await rawPost<{ proxified_url: string }>(
              '/proxy/generate',
              {
                url: data.url,
                filename: data.filename || undefined,
                requestHeaders: Object.keys(data.requestHeaders || {}).length
                  ? data.requestHeaders
                  : undefined,
                responseHeaders: Object.keys(data.responseHeaders || {}).length
                  ? data.responseHeaders
                  : undefined,
                type: data.type || 'stream',
                encrypt: data.encrypt !== false,
              }
            );
            setResult(res.proxified_url);
            const next = [res.proxified_url, ...history].slice(0, 20);
            setHistory(next);
            localStorage.setItem(HIST_KEY, JSON.stringify(next));
          } catch (e: any) {
            toast.error(e?.message ?? 'Failed to generate');
          } finally {
            setBusy(false);
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
            <Field.Submit loading={busy}>Generate</Field.Submit>
          </div>
        )}
      </Form>

      {result && (
        <div className="mt-4 p-3 rounded-lg bg-[--subtle] flex items-center gap-2">
          <code className="text-xs break-all flex-1">{result}</code>
          <Button
            size="sm"
            intent="gray-outline"
            leftIcon={<BiCopy />}
            onClick={() =>
              copyToClipboard(result, {
                onSuccess() {
                  toast.success('Copied to clipboard');
                },
                onError(error) {
                  toast.error('Failed to copy to clipboard');
                },
              })
            }
          >
            Copy
          </Button>
        </div>
      )}

      {history.length > 0 && (
        <div className="mt-4">
          <p className="text-xs text-[--muted] mb-1">Recent (this browser)</p>
          <ul className="space-y-1 max-h-40 overflow-auto">
            {history.map((h, i) => (
              <li key={i} className="flex items-center gap-2">
                <code className="text-[10px] break-all flex-1 text-[--muted]">
                  {h}
                </code>
                <button
                  className="text-[--muted] hover:text-[--foreground]"
                  onClick={() =>
                    copyToClipboard(h, {
                      onSuccess() {
                        toast.success('Copied to clipboard');
                      },
                      onError(error) {
                        toast.error('Failed to copy to clipboard');
                      },
                    })
                  }
                >
                  <BiCopy />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}

export function ProxyPage() {
  const [tab, setTab] = React.useState<'active' | 'history'>('active');
  const stats = useQuery({
    queryKey: ['dashboard', 'proxy', 'stats'],
    queryFn: () => rawGet<ProxyStats>('/proxy/stats'),
    refetchInterval: 5000,
    staleTime: 4000,
  });

  const rows = React.useMemo(() => {
    const out: Array<Conn & { username: string }> = [];
    for (const u of stats.data?.users ?? [])
      for (const c of u[tab]) out.push({ ...c, username: u.username });
    return out.sort((a, b) => b.lastSeen - a.lastSeen);
  }, [stats.data, tab]);

  return (
    <PageWrapper className="p-4 sm:p-8 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2>Proxy</h2>
          <p className="text-[--muted]">
            {stats.data
              ? `${stats.data.summary.totalActiveConnections} active · ${stats.data.summary.usersWithActiveConnections} users`
              : 'Live proxy connections'}
          </p>
        </div>
        <GenerateModal />
      </div>

      <div className="flex gap-1">
        {(['active', 'history'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'px-3 py-1 rounded-md text-xs font-medium border capitalize',
              tab === t
                ? 'border-brand bg-brand/10 text-brand'
                : 'border-[--border] text-[--muted] hover:text-[--foreground]'
            )}
          >
            {t}
          </button>
        ))}
      </div>

      <DashboardQueryBoundary
        query={stats}
        errorTitle="Failed to load proxy stats"
      >
        {() => (
          <Card className="p-0 overflow-hidden">
            {rows.length === 0 ? (
              <p className="p-8 text-center text-[--muted]">
                No {tab} connections.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-[--muted] text-xs uppercase bg-[--subtle]/40">
                  <tr className="text-left">
                    <th className="p-3">User</th>
                    <th className="p-3">IP</th>
                    <th className="p-3">Target</th>
                    <th className="p-3 text-right">Reqs</th>
                    <th className="p-3">Since</th>
                    <th className="p-3">Last seen</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c, i) => (
                    <tr
                      key={i}
                      className="border-t border-[--border]/50 hover:bg-[--subtle]/30"
                    >
                      <td className="p-3 font-medium">{c.username}</td>
                      <td className="p-3 font-mono text-xs">{c.ip}</td>
                      <td className="p-3 max-w-[360px] truncate" title={c.url}>
                        {c.filename || c.url}
                      </td>
                      <td className="p-3 text-right tabular-nums">{c.count}</td>
                      <td className="p-3 text-xs text-[--muted]">
                        {rel(c.timestamp)}
                      </td>
                      <td className="p-3 text-xs text-[--muted]">
                        {rel(c.lastSeen)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        )}
      </DashboardQueryBoundary>
    </PageWrapper>
  );
}
