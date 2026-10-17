import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import React from 'react';
import { toast } from 'sonner';
import { Button } from '@aiostreams/ui/button';
import { Modal } from '@aiostreams/ui/modal';
import { currentHost } from '../lib/hosts';
import { useRestoreFocus } from '../lib/input';
import {
  applyLabel,
  applyUpdate,
  updateStatus,
  useUpdateState,
} from '../lib/hosts/shell';

/** Offered once a run; Settings keeps offering them. */
const offered = new Set<string>();

export function UpdatePrompt() {
  const update = useUpdateState();
  const ready = update?.state === 'ready' ? update : null;
  const [asking, setAsking] = React.useState<string | null>(null);
  const restoreFocus = useRestoreFocus(!!asking);
  React.useEffect(() => {
    if (!ready || offered.has(ready.version ?? '')) return;
    offered.add(ready.version ?? '');
    const text = updateStatus(ready);
    // A remote can't reach a toast.
    if (currentHost().tv) {
      setAsking(text);
      return;
    }
    toast.custom(
      (id) => <UpdateCard text={text} onLater={() => toast.dismiss(id)} />,
      { duration: Infinity }
    );
  }, [ready]);
  return (
    <Modal
      data-ui="dialog"
      data-name="update"
      open={!!asking}
      onOpenChange={(open) => !open && setAsking(null)}
      onCloseAutoFocus={restoreFocus}
      title={t`Update ready`}
      description={asking}
      contentClass="max-w-md"
    >
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          intent="gray-outline"
          className="rounded-full"
          onClick={() => setAsking(null)}
        >
          <Trans>Later</Trans>
        </Button>
        <Button
          intent="white"
          className="rounded-full"
          autoFocus
          onClick={() => {
            setAsking(null);
            applyUpdate();
          }}
        >
          {applyLabel()}
        </Button>
      </div>
    </Modal>
  );
}

function UpdateCard({ text, onLater }: { text: string; onLater(): void }) {
  return (
    <div data-ui="update-toast" className="w-full space-y-3">
      <div>
        <p className="font-semibold">
          <Trans>Update ready</Trans>
        </p>
        <p className="mt-1 text-xs font-normal text-[--muted] [overflow-wrap:anywhere]">
          {text}
        </p>
      </div>
      <div className="flex justify-end gap-2">
        <Button
          size="sm"
          intent="gray-subtle"
          className="rounded-full"
          onClick={onLater}
        >
          <Trans>Later</Trans>
        </Button>
        <Button
          size="sm"
          intent="white"
          className="rounded-full"
          onClick={applyUpdate}
        >
          {applyLabel()}
        </Button>
      </div>
    </div>
  );
}
