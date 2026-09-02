import React from 'react';
import { toast } from 'sonner';
import { BiRefresh } from 'react-icons/bi';
import { Alert } from '@/components/ui/alert';
import { Button, IconButton } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/components/ui/core/styling';
import {
  useFuseMountAction,
  useFuseStatus,
  type FuseMountState,
} from '../queries';
import { useConfigValue } from './use-config-value';

/**
 * The FUSE mount is runtime state, not a setting: it can be unavailable on a
 * host with no /dev/fuse, fail with an errno, or be unmounted on purpose, and
 * a toggle alone would say nothing about any of that.
 */
const STATE_LABEL: Record<FuseMountState, string> = {
  off: 'Off',
  unavailable: 'Unavailable',
  mounting: 'Mounting',
  mounted: 'Mounted',
  unmounted: 'Not mounted',
  error: 'Failed',
};

const STATE_TONE: Record<FuseMountState, string> = {
  mounted: 'bg-green-500/15 text-green-400',
  mounting: 'bg-blue-500/15 text-blue-400',
  unavailable: 'bg-yellow-500/15 text-yellow-400',
  error: 'bg-red-500/15 text-red-400',
  unmounted: 'bg-[--subtle] text-[--muted]',
  off: 'bg-[--subtle] text-[--muted]',
};

const normalise = (p: string) => p.trim().replace(/\/+$/, '');

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <span className="text-[--muted]">{label}</span>
      <span className="font-mono text-right break-all">{value}</span>
    </div>
  );
}

export function FuseStatusPanel() {
  const enabled = useConfigValue('shares.fuse.enabled') === 'true';
  const status = useFuseStatus({ enabled });
  const action = useFuseMountAction();
  const configuredPath = useConfigValue('shares.fuse.mountPath');
  const arrMountDir = useConfigValue('arr.mountDir');

  if (!enabled) return null;

  const s = status.data;
  const mountPath = s?.mountPath || configuredPath || '/mnt/aiostreams';
  const state: FuseMountState = s?.state ?? 'off';
  const busy = action.isPending || state === 'mounting';

  const run = async (kind: 'mount' | 'unmount') => {
    try {
      const next = await action.mutateAsync(kind);
      if (next.state === 'mounted')
        toast.success(`Mounted at ${next.mountPath}`);
      else if (next.state === 'unmounted') toast.success('Unmounted');
      else if (next.error) toast.error(next.error);
      else if (next.reason) toast.warning(next.reason);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">Mount status</p>
          <p className="text-sm text-[--muted]">
            AIOStreams mounts the library itself; Sonarr, Radarr and your media
            server read it as an ordinary folder with real symlinks.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span
            className={cn(
              'rounded-full px-2.5 py-0.5 text-xs font-medium',
              STATE_TONE[state]
            )}
          >
            {STATE_LABEL[state]}
          </span>
          <IconButton
            size="sm"
            intent="white-subtle"
            icon={<BiRefresh />}
            loading={status.isFetching}
            onClick={() => status.refetch()}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Row label="Mount path" value={mountPath} />
        {s?.since && state === 'mounted' && (
          <Row label="Since" value={new Date(s.since).toLocaleString()} />
        )}
        {s?.stats && state === 'mounted' && (
          <>
            <Row label="Open files" value={s.stats.openFiles} />
            <Row label="In-flight reads" value={s.stats.pendingRequests} />
            <Row label="Cached inodes" value={s.stats.inodes} />
            <Row
              label="Requests"
              value={`${s.stats.requests} (${s.stats.errors} failed)`}
            />
          </>
        )}
      </div>

      {state === 'unavailable' && s?.reason && (
        <Alert
          intent="warning"
          title="This host cannot mount"
          description={s.reason}
        />
      )}
      {state === 'error' && s?.error && (
        <Alert intent="alert" title="Mount failed" description={s.error} />
      )}
      {status.error && (
        <Alert
          intent="alert"
          title="Could not read the mount status"
          description={(status.error as Error).message}
        />
      )}

      {!arrMountDir.trim() ? (
        <Alert
          intent="warning"
          title="Sonarr / Radarr mount directory is empty"
          description={`Set it to ${mountPath} (the path the arr sees the mount at) so the symlinks it imports resolve. Grabs work without it; imports do not.`}
        />
      ) : normalise(arrMountDir) !== normalise(mountPath) ? (
        <Alert
          intent="info"
          title="Mount directory differs from the FUSE mount path"
          description={`Sonarr / Radarr are told ${normalise(arrMountDir)} while AIOStreams mounts at ${normalise(mountPath)}. That is right only if the arr container binds the mount at a different path; otherwise make them the same.`}
        />
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          intent="primary"
          loading={busy && action.variables === 'mount'}
          disabled={busy || state === 'mounted'}
          onClick={() => run('mount')}
        >
          {state === 'error' || state === 'unavailable'
            ? 'Retry mount'
            : 'Mount'}
        </Button>
        <Button
          size="sm"
          intent="gray-outline"
          loading={busy && action.variables === 'unmount'}
          disabled={busy || state !== 'mounted'}
          onClick={() => run('unmount')}
        >
          Unmount
        </Button>
      </div>
    </Card>
  );
}
