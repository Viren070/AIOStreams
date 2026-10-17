import React from 'react';
import { toast } from 'sonner';
import { BiCopy, BiDownload, BiSearch, BiTrash } from 'react-icons/bi';
import { Button } from '@aiostreams/ui/button';
import { Card } from '@aiostreams/ui/card';
import { Checkbox } from '@aiostreams/ui/checkbox';
import { Modal } from '@aiostreams/ui/modal';
import { TextInput } from '@aiostreams/ui/text-input';
import {
  Pagination,
  PaginationEllipsis,
  PaginationItem,
  PaginationTrigger,
  pageWindow,
} from '@aiostreams/ui/pagination';
import {
  ConfirmationDialog,
  useConfirmationDialog,
} from '@aiostreams/ui/shared/confirmation-dialog';
import { copyToClipboard } from '@aiostreams/ui/utils/clipboard';
import { PageWrapper } from '@/components/shared/page-wrapper';
import { DashboardQueryBoundary } from '@/components/shared/dashboard-query-boundary';
import { Pill, relativeTime } from '@/app/dashboard/streams/_components/shared';
import {
  useDeleteReports,
  useReport,
  useReports,
  type AppReportListing,
} from './queries';

/** Where a report came from: one of this server's users, or a server that passed it on. */
function fromOf(r: AppReportListing): string {
  if (r.origin) return `via ${r.origin}`;
  if (r.uuid)
    return `${r.uuid.slice(0, 8)}${r.persona ? ` · ${r.persona}` : ''}`;
  return '—';
}

/**
 * Reports the apps sent: one of this server's users sent it, or on a server
 * that takes them from anyone, another server passed it on. Each has a code
 * its sender was shown, to look it up by.
 */
export function ReportsPage() {
  const [page, setPage] = React.useState(1);
  const reports = useReports(page);
  const remove = useDeleteReports();
  const [open, setOpen] = React.useState<string | null>(null);
  const [code, setCode] = React.useState('');
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const items = reports.data?.items ?? [];
  const total = reports.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / (reports.data?.pageSize ?? 1)));
  // A page emptied by deleting falls back to the last one left.
  React.useEffect(() => {
    if (page > pages) setPage(pages);
  }, [page, pages]);

  const deleted = (n: number) => {
    toast.success(n === 1 ? 'Report deleted' : `${n} reports deleted`);
    setSelected(new Set());
  };
  const deleteSelected = useConfirmationDialog({
    title: `Delete ${selected.size} selected`,
    description: 'These reports are deleted for good.',
    actionText: 'Delete',
    actionIntent: 'alert-subtle',
    onConfirm: () =>
      remove
        .mutateAsync({ codes: [...selected] })
        .then((r) => deleted(r.removed))
        .catch((e: Error) => toast.error(e.message)),
  });
  const deleteAll = useConfirmationDialog({
    title: 'Delete every report',
    description: `All ${total} reports are deleted for good.`,
    actionText: 'Delete all',
    actionIntent: 'alert-subtle',
    onConfirm: () =>
      remove
        .mutateAsync({ all: true })
        .then((r) => deleted(r.removed))
        .catch((e: Error) => toast.error(e.message)),
  });

  const onPage = items.map((r) => r.code);
  const allOnPage = onPage.length > 0 && onPage.every((c) => selected.has(c));
  const someOnPage = onPage.some((c) => selected.has(c));
  const toggle = (codes: string[], on: boolean) =>
    setSelected((now) => {
      const next = new Set(now);
      for (const c of codes) {
        if (on) next.add(c);
        else next.delete(c);
      }
      return next;
    });

  return (
    <PageWrapper className="space-y-4 p-4 sm:p-8">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2>Reports</h2>
          <p className="text-[--muted]">
            Crashes and problems the apps reported, kept for{' '}
            <code>APP_REPORTS_RETENTION</code>.
          </p>
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (code.trim()) setOpen(code.trim());
          }}
        >
          <TextInput
            aria-label="Report code"
            placeholder="ABC-DEFG"
            value={code}
            onValueChange={setCode}
            className="font-mono uppercase"
          />
          <Button type="submit" intent="primary" leftIcon={<BiSearch />}>
            Open
          </Button>
        </form>
      </div>
      {total > 0 && (
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            size="sm"
            intent="alert-subtle"
            leftIcon={<BiTrash />}
            disabled={!selected.size || remove.isPending}
            onClick={() => deleteSelected.open()}
          >
            Delete selected
          </Button>
          <Button
            size="sm"
            intent="gray-outline"
            leftIcon={<BiTrash />}
            disabled={remove.isPending}
            onClick={() => deleteAll.open()}
          >
            Delete all
          </Button>
        </div>
      )}
      <DashboardQueryBoundary
        query={reports}
        errorTitle="Failed to load reports"
      >
        {() =>
          !items.length ? (
            <Card className="p-8">
              <p className="text-center text-sm text-[--muted]">
                No reports yet.
              </p>
            </Card>
          ) : (
            <Card className="overflow-hidden p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-[--subtle]/40 text-xs uppercase text-[--muted]">
                    <tr className="text-left">
                      <th className="w-10 p-3">
                        <Checkbox
                          aria-label="Select this page"
                          value={
                            allOnPage
                              ? true
                              : someOnPage
                                ? 'indeterminate'
                                : false
                          }
                          onValueChange={() => toggle(onPage, !allOnPage)}
                        />
                      </th>
                      <th className="p-3">Code</th>
                      <th className="p-3">Kind</th>
                      <th className="p-3">What</th>
                      <th className="p-3">App</th>
                      <th className="p-3">From</th>
                      <th className="p-3">Sent</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((r) => (
                      <tr
                        key={r.code}
                        onClick={() => setOpen(r.code)}
                        className="cursor-pointer border-t border-[--border]/50 hover:bg-[--subtle]/30"
                      >
                        <td
                          className="p-3"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Checkbox
                            aria-label={`Select ${r.code}`}
                            value={selected.has(r.code)}
                            onValueChange={(on) => toggle([r.code], !!on)}
                          />
                        </td>
                        <td className="p-3 font-mono">{r.code}</td>
                        <td className="p-3">
                          <Pill>{r.kind === 'crash' ? 'Crash' : 'Report'}</Pill>
                        </td>
                        <td className="max-w-[420px] truncate p-3">
                          {r.note || r.headline}
                        </td>
                        <td className="p-3 text-xs text-[--muted]">
                          {r.platform} {r.appVersion}
                          <br />
                          {r.device}
                        </td>
                        <td className="p-3 text-xs text-[--muted]">
                          {fromOf(r)}
                        </td>
                        <td className="p-3 text-xs text-[--muted]">
                          {relativeTime(r.createdAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {pages > 1 && (
                <div className="flex justify-end border-t border-[--border]/50 p-3">
                  <Pagination>
                    <PaginationTrigger
                      direction="previous"
                      isDisabled={page <= 1}
                      onClick={() => setPage(Math.max(1, page - 1))}
                    />
                    {pageWindow(page, pages).map((p, i) =>
                      p === '…' ? (
                        <PaginationEllipsis key={`e${i}`} />
                      ) : (
                        <PaginationItem
                          key={p}
                          value={p}
                          data-selected={p === page}
                          onClick={() => setPage(p)}
                        />
                      )
                    )}
                    <PaginationTrigger
                      direction="next"
                      isDisabled={page >= pages}
                      onClick={() => setPage(Math.min(pages, page + 1))}
                    />
                  </Pagination>
                </div>
              )}
            </Card>
          )
        }
      </DashboardQueryBoundary>
      <ReportModal code={open} onClose={() => setOpen(null)} />
      <ConfirmationDialog {...deleteSelected} />
      <ConfirmationDialog {...deleteAll} />
    </PageWrapper>
  );
}

function ReportModal({
  code,
  onClose,
}: {
  code: string | null;
  onClose: () => void;
}) {
  const report = useReport(code);
  const remove = useDeleteReports();
  const r = report.data;
  return (
    <Modal
      open={!!code}
      onOpenChange={(next) => !next && onClose()}
      title={r ? `Report ${r.code}` : 'Report'}
      description={
        r
          ? `${r.kind === 'crash' ? 'Crash' : 'Report'} · ${r.platform} ${r.appVersion} · ${r.device} · ${fromOf(r)} · ${new Date(r.createdAt).toLocaleString()}`
          : undefined
      }
      contentClass="max-w-5xl"
    >
      {report.isLoading ? (
        <p className="text-[--muted]">Loading…</p>
      ) : !r ? (
        <p className="text-[--muted]">
          {report.error?.message ?? 'No report has that code.'}
        </p>
      ) : (
        <div className="space-y-3">
          {r.note && (
            <p className="whitespace-pre-wrap rounded-lg bg-[--subtle]/40 p-3">
              {r.note}
            </p>
          )}
          <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/40 p-3 font-mono text-xs">
            {r.details || r.summary}
          </pre>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              size="sm"
              intent="gray-outline"
              leftIcon={<BiCopy />}
              onClick={() =>
                void copyToClipboard(r.details || r.summary, {
                  onSuccess: () => toast.success('Copied'),
                  onError: () => toast.error('Could not copy'),
                })
              }
            >
              Copy
            </Button>
            <Button
              size="sm"
              intent="gray-outline"
              leftIcon={<BiDownload />}
              onClick={() => {
                const url = URL.createObjectURL(
                  new Blob([r.details || r.summary], { type: 'text/plain' })
                );
                const a = document.createElement('a');
                a.href = url;
                a.download = `aiostreams-report-${r.code}.txt`;
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              Download
            </Button>
            <Button
              size="sm"
              intent="alert-subtle"
              leftIcon={<BiTrash />}
              loading={remove.isPending}
              onClick={() =>
                remove
                  .mutateAsync({ codes: [r.code] })
                  .then(() => {
                    toast.success('Report deleted');
                    onClose();
                  })
                  .catch((e: Error) => toast.error(e.message))
              }
            >
              Delete
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
