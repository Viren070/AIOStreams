import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import React from 'react';
import { BiPlay } from 'react-icons/bi';
import { Button } from '@aiostreams/ui/button';
import { Modal } from '@aiostreams/ui/modal';
import { useSession } from '@/lib/jellyfin/session';
import {
  rememberChannel,
  remindersOf,
  setReminders,
  type Reminder,
} from './live-tv';
import { playbackNow } from '@/lib/playback/session';
import { clockTime } from '@/lib/format';
import type { BaseItemDto } from '@/lib/jellyfin/types';
import { useVersionPicker } from '@/features/versions/version-picker';

/** A reminder shows this long before its programme starts, and until this long after. */
const EARLY_MS = 60_000;
const LATE_MS = 10 * 60_000;
const CHECK_MS = 15_000;

/** Asks whether to watch a programme as it starts, while the app is open. */
export function ReminderHost() {
  const { user } = useSession();
  const userId = user.Id!;
  const picker = useVersionPicker();
  const [due, setDue] = React.useState<Reminder | null>(null);
  const showing = React.useRef(false);
  showing.current = !!due;

  React.useEffect(() => {
    const check = () => {
      const now = Date.now();
      const current = remindersOf(userId);
      const ready = showing.current
        ? undefined
        : current.find((r) => r.start - EARLY_MS <= now);
      const kept = current.filter(
        (r) => r !== ready && r.start + LATE_MS >= now
      );
      if (kept.length !== current.length) setReminders(userId, kept);
      // Already on that channel, there is nothing to ask.
      if (ready && playbackNow()?.itemId !== ready.channelId) setDue(ready);
    };
    check();
    const timer = setInterval(check, CHECK_MS);
    return () => clearInterval(timer);
  }, [userId]);

  const at = due ? clockTime(due.start) : '';
  const channelName = due?.channelName ?? '';
  const watch = () => {
    if (!due) return;
    const channel = {
      Id: due.channelId,
      Name: due.channelName,
      Type: 'TvChannel',
    } as BaseItemDto;
    setDue(null);
    rememberChannel(due.channelId);
    picker.play(channel);
  };
  return (
    <Modal
      data-ui="dialog"
      data-name="reminder"
      open={!!due}
      onOpenChange={(open) => !open && setDue(null)}
      title={due?.title}
      description={due ? t`${at} on ${channelName}` : undefined}
      contentClass="max-w-md"
      footer={
        <>
          <Button
            intent="gray-outline"
            className="rounded-full"
            onClick={() => setDue(null)}
          >
            <Trans>Dismiss</Trans>
          </Button>
          <Button
            data-name="watch"
            intent="white"
            className="rounded-full"
            leftIcon={<BiPlay />}
            autoFocus
            onClick={watch}
          >
            <Trans>Watch</Trans>
          </Button>
        </>
      }
    />
  );
}
