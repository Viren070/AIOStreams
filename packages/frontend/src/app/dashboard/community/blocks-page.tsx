import React from 'react';
import { toast } from 'sonner';
import { BiTrash } from 'react-icons/bi';
import { Card } from '@/components/ui/card';
import { IconButton } from '@/components/ui/button';
import { DashboardQueryBoundary } from '@/components/shared/dashboard-query-boundary';
import { Pill, relativeTime } from '@/app/dashboard/streams/_components/shared';
import { useCommunityBlocks, useRemoveBlock } from './queries';

/**
 * Blocks are keyed hashes of the uploader's configuration or address, added
 * from an item in the review queue. Nothing here identifies a person.
 */
export function CommunityBlocksPage() {
  const blocks = useCommunityBlocks();
  const remove = useRemoveBlock();

  return (
    <div className="space-y-4">
      <p className="text-xs text-[--muted]">
        Blocked configurations and addresses cannot upload, update or like
        community items. Add a block from an item in the review queue.
      </p>
      <DashboardQueryBoundary query={blocks} errorTitle="Failed to load blocks">
        {(data) =>
          data.blocks.length === 0 ? (
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
                      <th className="p-3">Kind</th>
                      <th className="p-3">Hash</th>
                      <th className="p-3">Reason</th>
                      <th className="p-3">Added</th>
                      <th className="p-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {data.blocks.map((b) => (
                      <tr
                        key={b.hash}
                        className="border-t border-[--border]/50 hover:bg-[--subtle]/30"
                      >
                        <td className="p-3">
                          <Pill>
                            {b.kind === 'owner' ? 'Configuration' : 'Address'}
                          </Pill>
                        </td>
                        <td className="p-3 font-mono text-xs text-[--muted]">
                          {b.hash.slice(0, 12)}…
                        </td>
                        <td className="max-w-[320px] truncate p-3 text-[--muted]">
                          {b.reason || '—'}
                        </td>
                        <td className="p-3 text-xs text-[--muted]">
                          {relativeTime(b.createdAt)}
                        </td>
                        <td className="p-3 text-right">
                          <IconButton
                            size="sm"
                            intent="gray-subtle"
                            icon={<BiTrash />}
                            aria-label="Lift block"
                            disabled={remove.isPending}
                            onClick={() =>
                              remove
                                .mutateAsync(b.hash)
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
