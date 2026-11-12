import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { toast } from 'sonner';
import { Button } from '@aiostreams/ui/button';
import { Modal } from '@aiostreams/ui/modal';
import { currentHost } from '@/lib/hosts';
import { useRestoreFocus } from '@/lib/input';
import { settings, useSetting } from '@/lib/settings';
import { chooseUsageStats, sendUsageStats } from '@/lib/usage-stats';

const CHECK_MS = 60 * 60_000;

export const usageStatsText = () =>
  t`Once a day, the app sends an anonymous count with your type of device, system, app version, language, and country and region. Nothing that identifies you or what you watch is kept.`;

function NoticeText() {
  return (
    <>
      <p>{usageStatsText()}</p>
      <p className="mt-2">
        <Trans>You can change this later in Settings, under About.</Trans>
      </p>
    </>
  );
}

/** Nothing is sent until the notice is answered. */
export function UsageStats() {
  const [on] = useSetting(settings.app.usageStats);
  const [noticed] = useSetting(settings.app.usageStatsNoticed);
  const [asking, setAsking] = React.useState(false);
  const restoreFocus = useRestoreFocus(asking);
  const close = React.useCallback((keepOn: boolean) => {
    chooseUsageStats(keepOn);
    setAsking(false);
  }, []);

  React.useEffect(() => {
    if (noticed || !on) return;
    // A remote can't reach a toast.
    if (currentHost().tv) {
      setAsking(true);
      return;
    }
    // Dismissing it on the way out isn't the user seeing it.
    let open = true;
    const done = (keepOn: boolean) => {
      if (!open) return;
      open = false;
      close(keepOn);
      toast.dismiss(id);
    };
    const id = toast.custom(() => <NoticeCard onClose={done} />, {
      duration: Infinity,
      onDismiss: () => done(true),
    });
    return () => {
      if (!open) return;
      open = false;
      toast.dismiss(id);
    };
  }, [noticed, on, close]);

  React.useEffect(() => {
    if (!noticed || !on) return;
    const check = () => {
      if (document.visibilityState === 'visible') void sendUsageStats();
    };
    check();
    const timer = setInterval(check, CHECK_MS);
    document.addEventListener('visibilitychange', check);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
    };
  }, [noticed, on]);

  return (
    <Modal
      data-ui="dialog"
      data-name="usage-stats"
      open={asking}
      onOpenChange={(open) => !open && close(true)}
      onCloseAutoFocus={restoreFocus}
      title={t`Usage statistics`}
      description={<NoticeText />}
      contentClass="max-w-md"
    >
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          intent="gray-outline"
          className="rounded-full"
          onClick={() => close(false)}
        >
          <Trans>Turn off</Trans>
        </Button>
        <Button
          intent="white"
          className="rounded-full"
          autoFocus
          onClick={() => close(true)}
        >
          <Trans>OK</Trans>
        </Button>
      </div>
    </Modal>
  );
}

function NoticeCard({ onClose }: { onClose(keepOn: boolean): void }) {
  return (
    <div data-ui="usage-stats-toast" className="w-full space-y-3">
      <div>
        <p className="font-semibold">
          <Trans>Usage statistics</Trans>
        </p>
        <div className="mt-1 text-xs font-normal text-[--muted]">
          <NoticeText />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button
          size="sm"
          intent="gray-subtle"
          className="rounded-full"
          onClick={() => onClose(false)}
        >
          <Trans>Turn off</Trans>
        </Button>
        <Button
          size="sm"
          intent="white"
          className="rounded-full"
          onClick={() => onClose(true)}
        >
          <Trans>OK</Trans>
        </Button>
      </div>
    </div>
  );
}
