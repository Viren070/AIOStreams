import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Button } from '@aiostreams/ui/button';
import { Modal } from '@aiostreams/ui/modal';
import { Switch } from '@aiostreams/ui/switch';
import { Textarea } from '@aiostreams/ui/textarea';
import { requestDiagnostics } from '../lib/hosts/shell';
import { appBridge } from '../lib/hosts/shell/bridge';
import { useRestoreFocus } from '../lib/input';
import { lastPlayedLine } from '../lib/last-played';
import { useServerInfo } from '../lib/server-info';
import { settingsSnapshot } from '../lib/settings';
import { useSession } from '../lib/session';

/** What a report carries besides the sender's note. */
export interface ReportContent {
  kind: 'crash' | 'report';
  summary: string;
  details: string;
}

interface Sent {
  code: string;
  forwarded: string | null;
  forwardError: string | null;
}

/** The start, which says what happened, and the end, the last log lines; the server keeps no more. */
const MAX_DETAILS = 192 * 1024;
function cut(details: string) {
  if (details.length <= MAX_DETAILS) return details;
  const head = MAX_DETAILS / 4;
  return `${details.slice(0, head)}\n[…]\n${details.slice(details.length - (MAX_DETAILS - head))}`;
}

/** A report's text with what last played and every setting as they are now, which a crash rarely changes. */
export function withContext(details: string): string {
  return [
    details,
    lastPlayedLine(),
    // eslint-disable-next-line lingui/no-unlocalized-strings -- report text, not shown
    `Settings: ${JSON.stringify(settingsSnapshot(), null, 1)}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** This device and the app's recent log, as Troubleshooting's report sends it. */
export async function diagnosticsReport(
  server: string | null
): Promise<ReportContent> {
  const text = await requestDiagnostics(server);
  // The versions and the device, ahead of the log.
  const head = text.split('\n\n', 1)[0] ?? '';
  return { kind: 'report', summary: head, details: text };
}

/**
 * Sends a report to the server, and on to the developer when asked, then
 * shows the code to give whoever reads it.
 */
export function SendReportDialog({
  open,
  content,
  onClose,
  onSent,
}: {
  open: boolean;
  /** Read when sending, so a slow one doesn't hold the dialog up. */
  content: () => Promise<ReportContent>;
  onClose: () => void;
  onSent?: () => void;
}) {
  const { client } = useSession();
  const info = useServerInfo();
  const [note, setNote] = React.useState('');
  const [forward, setForward] = React.useState(true);
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string>();
  const [sent, setSent] = React.useState<Sent | null>(null);
  const restoreFocus = useRestoreFocus(open);
  React.useEffect(() => {
    if (!open) return;
    setNote('');
    setForward(true);
    setError(undefined);
    setSent(null);
  }, [open]);
  const send = async () => {
    setSending(true);
    setError(undefined);
    try {
      const report = await content();
      const bridge = appBridge();
      const result = await client.post<Sent>('/AIOStreams/Reports', {
        ...report,
        details: cut(withContext(report.details)),
        note: note.trim(),
        platform: bridge?.platform ?? 'web',
        appVersion: bridge?.version ?? __APP_COMMIT__,
        device: bridge?.device ?? navigator.userAgent,
        forward,
      });
      setSent(result);
      onSent?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };
  return (
    <Modal
      data-ui="dialog"
      data-name="send-report"
      open={open}
      onOpenChange={(next) => !next && onClose()}
      onCloseAutoFocus={restoreFocus}
      title={t`Send a report`}
      description={
        sent
          ? undefined
          : t`It carries this device's details and the app's recent log. Passwords and tokens are left out.`
      }
    >
      {sent ? (
        <div className="space-y-4 text-center">
          <SentCodes sent={sent} />
          <Button intent="white" className="rounded-full" onClick={onClose}>
            <Trans>Done</Trans>
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <Textarea
            label={t`What happened`}
            help={t`Optional.`}
            value={note}
            onValueChange={setNote}
            className="min-h-20"
          />
          {info.reports?.forward && (
            <Switch
              side="right"
              label={t`Also send to the developer`}
              help={t`Configuration ids are left out of their copy too.`}
              value={forward}
              onValueChange={setForward}
            />
          )}
          {error && <p className="text-sm text-red-300">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button
              intent="gray-outline"
              className="rounded-full"
              onClick={onClose}
            >
              <Trans>Cancel</Trans>
            </Button>
            <Button
              intent="white"
              className="rounded-full"
              loading={sending}
              onClick={() => void send()}
            >
              <Trans>Send</Trans>
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** One code: the developer's when it reached them, as they're the one who reads it, else this server's. */
function SentCodes({ sent }: { sent: Sent }) {
  const { forwardError } = sent;
  const code = sent.forwarded ?? sent.code;
  return (
    <div data-ui="report-sent" className="space-y-4 text-center">
      <p className="text-[--muted]">
        <Trans>Give this code to whoever looks into it.</Trans>
      </p>
      <p
        data-ui="report-code"
        className="font-mono text-4xl font-semibold tracking-widest"
      >
        {code}
      </p>
      {forwardError && (
        <p className="text-sm text-red-300">
          <Trans>
            It didn&apos;t reach the developer, only this server: {forwardError}
          </Trans>
        </p>
      )}
    </div>
  );
}
