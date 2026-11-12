import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Button } from '@aiostreams/ui/button';
import { Modal } from '@aiostreams/ui/modal';
import { useSetPlayed } from '@/lib/jellyfin/watch-state';
import { itemSubtitle, itemTitle } from '@/lib/format';
import type { BaseItemDto } from '@/lib/jellyfin/types';

/** An external player reports nothing back, so the user marks it themselves. */
export function ExternalPrompt({
  item,
  onClose,
}: {
  item: BaseItemDto | null;
  onClose: () => void;
}) {
  const setPlayed = useSetPlayed();
  return (
    <Modal
      data-ui="dialog"
      data-name="external-player"
      open={!!item}
      onOpenChange={(open) => !open && onClose()}
      title={t`Playing in your player`}
      description={t`Your player does not report back, so mark it as watched once you finish.`}
      contentClass="max-w-md"
    >
      {item && (
        <>
          <p className="text-lg font-semibold">{itemTitle(item)}</p>
          {item.Type === 'Episode' && (
            <p className="text-sm text-[--muted]">{itemSubtitle(item)}</p>
          )}
          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            <Button
              intent="gray-outline"
              className="rounded-full"
              onClick={onClose}
            >
              <Trans>Not now</Trans>
            </Button>
            <Button
              intent="white"
              className="rounded-full"
              loading={setPlayed.isPending}
              onClick={() =>
                setPlayed.mutate(
                  { itemId: item.Id!, played: true },
                  { onSuccess: onClose }
                )
              }
            >
              <Trans>Mark as watched</Trans>
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
