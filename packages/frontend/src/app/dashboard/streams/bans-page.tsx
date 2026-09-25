import React from 'react';
import { toast } from 'sonner';
import { BiPlus, BiTrash } from 'react-icons/bi';
import { Card } from '@aiostreams/ui/card';
import { Button, IconButton } from '@aiostreams/ui/button';
import { Modal } from '@aiostreams/ui/modal';
import { TextInput } from '@aiostreams/ui/text-input';
import { Select } from '@aiostreams/ui/select';
import { BasicField } from '@aiostreams/ui/basic-field';
import { DashboardQueryBoundary } from '@/components/shared/dashboard-query-boundary';
import {
  useCreateStreamBan,
  useLiftStreamBan,
  useStreamBans,
  type StreamBan,
} from './queries';
import { BAN_DURATIONS, Pill, relativeTime } from './_components/shared';

function expiryLabel(ban: StreamBan): string {
  if (!ban.expiresAt) return 'Until lifted';
  const remaining = ban.expiresAt - Date.now();
  if (remaining <= 0) return 'Expired';
  const mins = Math.round(remaining / 60_000);
  if (mins < 60) return `${mins}m left`;
  const hours = Math.round(mins / 60);
  return hours < 48 ? `${hours}h left` : `${Math.round(hours / 24)}d left`;
}

/** Add a block without waiting for the user to appear on the Active list. */
function AddBlockModal() {
  const [open, setOpen] = React.useState(false);
  const [username, setUsername] = React.useState('');
  const [durationIdx, setDurationIdx] = React.useState('0');
  const [reason, setReason] = React.useState('');
  const create = useCreateStreamBan();

  const submit = async () => {
    if (!username.trim()) {
      toast.error('Username is required');
      return;
    }
    try {
      await create.mutateAsync({
        scope: 'user',
        username: username.trim(),
        reason: reason.trim() || undefined,
        durationMs: BAN_DURATIONS[Number(durationIdx)]?.ms,
      });
      toast.success('Blocked');
      setOpen(false);
      setUsername('');
      setReason('');
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to block');
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={setOpen}
      title="Block a user"
      trigger={
        <Button intent="alert-subtle" size="sm" leftIcon={<BiPlus />}>
          Block a user
        </Button>
      }
    >
      <div className="space-y-4">
        <BasicField
          label="Username"
          help="Must match a username in AIOSTREAMS_AUTH."
        >
          <TextInput
            value={username}
            onValueChange={setUsername}
            placeholder="alice"
          />
        </BasicField>
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
          <TextInput value={reason} onValueChange={setReason} />
        </BasicField>
        <div className="flex justify-end gap-2">
          <Button
            intent="gray-outline"
            size="sm"
            onClick={() => setOpen(false)}
          >
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

/**
 * Blocks in force. A user block refuses every stream; a title block refuses one
 * target. Both are additive to Stop, which only ends the current stream.
 */
export function StreamsBansPage() {
  const bans = useStreamBans();
  const lift = useLiftStreamBan();
  const entries = bans.data?.bans ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-[--muted]">
          A block refuses new streams. Stopping a stream on its own only ends
          the current one — a player will reopen it.
        </p>
        <AddBlockModal />
      </div>

      <DashboardQueryBoundary query={bans} errorTitle="Failed to load blocks">
        {() =>
          entries.length === 0 ? (
            <Card className="p-8">
              <p className="text-center text-sm text-[--muted]">
                No blocks in force.
              </p>
            </Card>
          ) : (
            <Card className="overflow-hidden p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-[--subtle]/40 text-xs uppercase text-[--muted]">
                    <tr className="text-left">
                      <th className="p-3">User</th>
                      <th className="p-3">Scope</th>
                      <th className="p-3">Reason</th>
                      <th className="p-3">Added</th>
                      <th className="p-3">Expires</th>
                      <th className="p-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((b) => (
                      <tr
                        key={b.id}
                        className="border-t border-[--border]/50 hover:bg-[--subtle]/30"
                      >
                        <td className="p-3 font-medium">{b.username}</td>
                        <td className="p-3">
                          <Pill>
                            {b.scope === 'user' ? 'All streams' : 'One title'}
                          </Pill>
                        </td>
                        <td className="max-w-[280px] truncate p-3 text-[--muted]">
                          {b.reason || '—'}
                        </td>
                        <td className="p-3 text-xs text-[--muted]">
                          {relativeTime(b.createdAt)}
                          {b.createdBy ? ` by ${b.createdBy}` : ''}
                        </td>
                        <td className="p-3 text-xs text-[--muted]">
                          {expiryLabel(b)}
                        </td>
                        <td className="p-3 text-right">
                          <IconButton
                            size="sm"
                            intent="gray-subtle"
                            icon={<BiTrash />}
                            aria-label="Lift block"
                            disabled={lift.isPending}
                            onClick={() =>
                              lift
                                .mutateAsync(b.id)
                                .then(() => toast.success('Block lifted'))
                                .catch((e: any) =>
                                  toast.error(e?.message ?? 'Failed to lift')
                                )
                            }
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )
        }
      </DashboardQueryBoundary>
    </div>
  );
}
