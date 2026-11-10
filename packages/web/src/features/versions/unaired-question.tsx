import { t } from '@lingui/core/macro';
import {
  ConfirmationDialog,
  useConfirmationDialog,
} from '@aiostreams/ui/shared/confirmation-dialog';
import { useRestoreFocus } from '@/lib/input';
import { dayLabel, untilLabel } from '@/lib/format';
import type { BaseItemDto } from '@/lib/jellyfin/types';

export interface Unaired {
  item: BaseItemDto;
  go: () => void;
  action: 'play' | 'download';
}

export function UnairedQuestion({
  asking,
  onClose,
}: {
  asking: Unaired | null;
  onClose: () => void;
}) {
  const item = asking?.item;
  const date = item?.PremiereDate;
  const name = item?.Name ?? '';
  const day = date ? dayLabel(date) : '';
  const until = date ? untilLabel(date) : '';
  const restoreFocus = useRestoreFocus(!!asking);
  const question = useConfirmationDialog({
    title: t`Not aired yet`,
    description:
      asking?.action === 'download'
        ? t`${name} airs ${day} (${until}). Download it anyway?`
        : t`${name} airs ${day} (${until}). Play it anyway?`,
    actionText:
      asking?.action === 'download' ? t`Download anyway` : t`Play anyway`,
    // Once this dialog has handed focus back, so the next one keeps it.
    onConfirm: () => asking && setTimeout(asking.go),
  });
  return (
    <ConfirmationDialog
      {...question}
      name="unaired"
      onCloseAutoFocus={restoreFocus}
      isOpen={!!asking}
      close={onClose}
    />
  );
}
