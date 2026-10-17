import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { toast } from 'sonner';
import { Button } from '@aiostreams/ui/button';
import { Modal } from '@aiostreams/ui/modal';
import { copyToClipboard } from '@aiostreams/ui/utils/clipboard';
import { currentHost } from '../lib/hosts';
import {
  crashReportSeen,
  requestCrashReport,
  type CrashReport,
} from '../lib/hosts/shell';
import { appBridge } from '../lib/hosts/shell/bridge';
import { useServerInfo } from '../lib/server-info';
import { SendReportDialog, withContext } from './send-report';

/** How the app's last run ended, when it crashed or was closed while in use, shown once on the next start. */
export function CrashReportDialog() {
  const [report, setReport] = React.useState<CrashReport | null>(null);
  const [sending, setSending] = React.useState(false);
  const info = useServerInfo();
  React.useEffect(() => {
    requestCrashReport().then(setReport, () => undefined);
  }, []);
  if (!report) return null;
  const close = () => {
    crashReportSeen(report.at);
    setReport(null);
  };
  if (sending)
    return (
      <SendReportDialog
        open
        content={async () => ({
          kind: 'crash',
          summary: report.summary,
          details: report.details,
        })}
        onClose={close}
      />
    );
  const save = currentHost().saveFile;
  const stamp = new Date(report.at)
    .toISOString()
    .slice(0, 19)
    .replace(/[:T]/g, '-');
  return (
    <Modal
      data-ui="dialog"
      data-name="crash-report"
      open
      onOpenChange={(open) => !open && close()}
      title={t`The app closed unexpectedly`}
      description={t`This is what the device recorded about it. Sending or saving the report helps get it fixed.`}
      contentClass="max-w-3xl"
    >
      <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap break-words rounded-xl bg-black/40 p-3 font-mono text-xs leading-relaxed">
        {report.summary}
      </pre>
      <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
        {info.reports && (
          <Button
            intent="gray-outline"
            className="rounded-full"
            onClick={() => setSending(true)}
          >
            <Trans>Send report</Trans>
          </Button>
        )}
        {save && (
          <Button
            intent="gray-outline"
            className="rounded-full"
            onClick={() =>
              save(
                `aiostreams-crash-${stamp}.txt`,
                'text/plain',
                withContext(report.details)
              )
            }
          >
            <Trans>Save report</Trans>
          </Button>
        )}
        {!appBridge()?.tv && (
          <Button
            intent="gray-outline"
            className="rounded-full"
            onClick={() =>
              void copyToClipboard(withContext(report.details), {
                onSuccess: () => toast.success(t`Report copied`),
                onError: () => toast.error(t`Could not copy it`),
              })
            }
          >
            <Trans>Copy</Trans>
          </Button>
        )}
        <Button intent="white" className="rounded-full" onClick={close}>
          <Trans>Close</Trans>
        </Button>
      </div>
    </Modal>
  );
}
