import React from 'react';
import { toast } from 'sonner';
import { BiCopy, BiHide, BiShow } from 'react-icons/bi';
import { Modal } from '@/components/ui/modal';
import { IconButton } from '@/components/ui/button';
import { cn } from '@/components/ui/core/styling';
import { copyToClipboard } from '@/utils/clipboard';
import { type LibraryEntry } from '../queries';
import { formatBytes, formatDateTime, formatLatency } from '@/lib/format';

function copy(text: string, label: string) {
  void copyToClipboard(text, {
    onSuccess: () => toast.success(`${label} copied`),
    onError: () => toast.error('Copy failed'),
  });
}

/** One label/value row; optionally copyable. */
function Row({
  label,
  value,
  onCopy,
  children,
}: {
  label: string;
  value?: React.ReactNode;
  onCopy?: () => void;
  children?: React.ReactNode;
}) {
  if (value == null && !children) return null;
  return (
    <div className="flex items-start gap-3 py-1.5 border-b border-[--border]/40 last:border-0">
      <span className="w-28 shrink-0 text-xs font-medium text-[--muted] pt-0.5">
        {label}
      </span>
      <div className="min-w-0 flex-1 text-sm flex items-center gap-2">
        {children ?? <span className="break-all">{value}</span>}
        {onCopy && (
          <IconButton
            size="xs"
            intent="gray-subtle"
            icon={<BiCopy />}
            aria-label={`Copy ${label}`}
            className="shrink-0 ml-auto"
            onClick={onCopy}
          />
        )}
      </div>
    </div>
  );
}

/** Masked, reveal-able, copyable secret row (password, NZB URL, etc). */
function SecretRow({ label, secret }: { label: string; secret: string }) {
  const [shown, setShown] = React.useState(false);
  return (
    <Row label={label}>
      <span className="font-mono break-all">
        {shown ? secret : '•'.repeat(Math.min(secret.length, 12))}
      </span>
      <IconButton
        size="xs"
        intent="gray-subtle"
        icon={shown ? <BiHide /> : <BiShow />}
        aria-label={shown ? `Hide ${label}` : `Show ${label}`}
        className="shrink-0 ml-auto"
        onClick={() => setShown((s) => !s)}
      />
      <IconButton
        size="xs"
        intent="gray-subtle"
        icon={<BiCopy />}
        aria-label={`Copy ${label}`}
        className="shrink-0"
        onClick={() => copy(secret, label)}
      />
    </Row>
  );
}

/** A cleanly-laid-out details panel for a library entry (replaces card clutter). */
export function EntryInfoModal({
  entry,
  open,
  onOpenChange,
}: {
  entry: LibraryEntry | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!entry) return null;
  const e = entry;
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="NZB details"
      contentClass="max-w-lg"
    >
      <div className={cn('mt-1')}>
        <Row
          label="Name"
          value={e.name || e.nzbHash}
          onCopy={() => copy(e.name || e.nzbHash, 'Name')}
        />
        <Row label="Status" value={e.status} />
        {e.status === 'failed' && e.failReason && (
          <Row label="Error" value={e.failReason} />
        )}
        <Row label="Size" value={formatBytes(e.size)} />
        <Row
          label="Files"
          value={`${e.files.length} file${e.files.length === 1 ? '' : 's'}`}
        />
        <Row label="Source" value={e.source} />
        {e.owner && <Row label="Added by" value={e.owner} />}
        <Row label="Added" value={formatDateTime(e.addedAt)} />
        <Row label="Last used" value={formatDateTime(e.lastUsedAt)} />
        {e.importMs != null && (
          <Row label="Import time" value={formatLatency(e.importMs)} />
        )}
        {e.password && <SecretRow label="Password" secret={e.password} />}
        {e.nzbUrl && <SecretRow label="NZB URL" secret={e.nzbUrl} />}
        <Row
          label="Hash"
          value={
            <span className="font-mono text-xs break-all">{e.nzbHash}</span>
          }
          onCopy={() => copy(e.nzbHash, 'Hash')}
        />
      </div>
    </Modal>
  );
}
