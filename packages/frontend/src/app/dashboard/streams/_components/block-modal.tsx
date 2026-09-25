import React from 'react';
import { toast } from 'sonner';
import { Modal } from '@aiostreams/ui/modal';
import { Button } from '@aiostreams/ui/button';
import { TextInput } from '@aiostreams/ui/text-input';
import { Select } from '@aiostreams/ui/select';
import { BasicField } from '@aiostreams/ui/basic-field';
import { useCreateStreamBan } from '../queries';
import { BAN_DURATIONS } from './shared';

export interface BlockTarget {
  scope: 'user' | 'target';
  username: string;
  targetKey?: string;
  /** What the target is, for the dialog copy. */
  label?: string;
}

/**
 * Temporarily block a user, or one title for a user. Additive to Stop, which
 * only ends the current stream; a block refuses the next one too.
 */
export function BlockModal({
  target,
  onClose,
}: {
  target: BlockTarget | null;
  onClose: () => void;
}) {
  const create = useCreateStreamBan();
  const [durationIdx, setDurationIdx] = React.useState('0');
  const [reason, setReason] = React.useState('');

  React.useEffect(() => {
    if (target) {
      setDurationIdx('0');
      setReason('');
    }
  }, [target]);

  if (!target) return null;

  const isUser = target.scope === 'user';
  const submit = async () => {
    try {
      const res = await create.mutateAsync({
        scope: target.scope,
        username: target.username,
        targetKey: target.targetKey,
        reason: reason.trim() || undefined,
        durationMs: BAN_DURATIONS[Number(durationIdx)]?.ms,
      });
      toast.success(
        res.stopped > 0
          ? `Blocked — stopped ${res.stopped} stream${res.stopped === 1 ? '' : 's'}`
          : 'Blocked'
      );
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to block');
    }
  };

  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title={isUser ? `Block ${target.username}` : 'Block this stream'}
    >
      <div className="space-y-4">
        <p className="text-sm text-[--muted]">
          {isUser ? (
            <>
              <span className="text-[--foreground]">{target.username}</span>{' '}
              will not be able to start any stream, and everything they have
              open now will be stopped.
            </>
          ) : (
            <>
              <span className="text-[--foreground]">{target.username}</span>{' '}
              will not be able to reopen{' '}
              <span className="break-all text-[--foreground]">
                {target.label || 'this title'}
              </span>
              . Their other streams keep working.
            </>
          )}
        </p>

        <BasicField label="Duration">
          <Select
            value={durationIdx}
            onValueChange={setDurationIdx}
            options={BAN_DURATIONS.map((d, i) => ({
              label: d.label,
              value: String(i),
            }))}
          />
        </BasicField>

        <BasicField label="Reason (optional)">
          <TextInput
            value={reason}
            onValueChange={setReason}
            placeholder="Shown on the Blocks list"
          />
        </BasicField>

        <div className="flex justify-end gap-2">
          <Button intent="gray-outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            intent="alert"
            size="sm"
            loading={create.isPending}
            onClick={submit}
          >
            Block
          </Button>
        </div>
      </div>
    </Modal>
  );
}
