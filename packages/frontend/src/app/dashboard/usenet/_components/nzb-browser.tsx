import React from 'react';
import { toast } from 'sonner';
import { BiPlay, BiDownload, BiFolder, BiFile, BiLink } from 'react-icons/bi';
import { Modal } from '@/components/ui/modal';
import { IconButton } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/components/ui/core/styling';
import { copyToClipboard } from '@/utils/clipboard';
import { useUsenetNzbFiles, usePlayUrl, type LibraryFile } from '../queries';
import { formatBytes } from '@/lib/format';

/** Group files by their top-level folder (derived from path or name). */
function groupByFolder(files: LibraryFile[]): Record<string, LibraryFile[]> {
  const groups: Record<string, LibraryFile[]> = {};
  for (const f of files) {
    const full = f.path ?? f.name ?? '';
    const slash = full.lastIndexOf('/');
    const folder = slash === -1 ? '' : full.slice(0, slash);
    (groups[folder] ||= []).push(f);
  }
  return groups;
}

function basename(f: LibraryFile): string {
  // Prefer the display `name` — for archive inner files the backend
  // de-obfuscates it to the release name (the inner `path` stays the obfuscated
  // RAR selector, used for folder grouping + the open URL). Fall back to the
  // leaf of `path` when there's no name.
  if (f.name) return f.name;
  const full = f.path ?? '';
  const slash = full.lastIndexOf('/');
  return slash === -1 ? full : full.slice(slash + 1);
}

/**
 * Order files within a folder predictably: videos first, then by category, then
 * by filename. Persisted file lists come back in inspect order (archive set
 * order), which reads arbitrarily in the tree.
 */
function sortFiles(files: LibraryFile[]): LibraryFile[] {
  const rank = (f: LibraryFile) => (f.category === 'video' ? 0 : 1);
  return [...files].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (a.category ?? '').localeCompare(b.category ?? '') ||
      basename(a).localeCompare(basename(b))
  );
}

/**
 * nzbdav-style file-tree explorer for a library NZB. Folders (and archive inner
 * paths) are grouped; each streamable file gets Preview/Download actions
 * against the byte-serving endpoint.
 */
export function NzbBrowser({
  hash,
  name,
  open,
  onOpenChange,
}: {
  hash: string | null;
  name?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const files = useUsenetNzbFiles(open ? hash : null);
  const playUrl = usePlayUrl();

  const fileSelOf = (file: LibraryFile) =>
    file.path ?? (file.index != null ? String(file.index) : file.name);

  const openUrl = (file: LibraryFile, download: boolean) => {
    if (!hash) return;
    playUrl
      .mutateAsync({ hash, fileSel: fileSelOf(file), download })
      .then((res) => window.open(res.url, '_blank'))
      .catch((e: any) => toast.error(e?.message ?? 'No playable source'));
  };

  /**
   * Mint a download URL and copy it to the clipboard. The minted token is
   * short-lived, so the copied link is meant for an immediate paste. The mint
   * returns a relative URL — prefix the origin to make it pasteable anywhere.
   */
  const copyLink = (file: LibraryFile) => {
    if (!hash) return;
    playUrl
      .mutateAsync({ hash, fileSel: fileSelOf(file), download: true })
      .then((res) =>
        copyToClipboard(window.location.origin + res.url, {
          onSuccess: () => toast.success('Download link copied'),
          onError: () => toast.error('Failed to copy link'),
        })
      )
      .catch((e: any) => toast.error(e?.message ?? 'No downloadable source'));
  };

  const groups = files.data ? groupByFolder(files.data.files) : {};
  const folders = Object.keys(groups).sort();

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={name || 'Browse NZB'}
      description="Files in this NZB (including stored archive contents)."
      contentClass="max-w-4xl"
    >
      <div className="max-h-[72vh] overflow-y-auto space-y-4">
        {files.isLoading ? (
          <p className="text-sm text-[--muted]">Loading…</p>
        ) : files.isError ? (
          <p className="text-sm text-red-500">Failed to load files.</p>
        ) : folders.length === 0 ? (
          <p className="text-sm text-[--muted]">No files.</p>
        ) : (
          folders.map((folder) => (
            <div key={folder || 'root'}>
              {folder && (
                <div className="flex items-center gap-1.5 text-xs text-[--muted] mb-1">
                  <BiFolder /> {folder}
                </div>
              )}
              <div className="space-y-1">
                {sortFiles(groups[folder]).map((f, i) => {
                  // `streamable` is the authoritative "can be byte-served on its
                  // own" flag: true for plain media files and for stored,
                  // unencrypted, non-solid archive members; false for par2,
                  // compressed/solid/encrypted members, etc. Those genuinely
                  // can't be served individually, so all three actions gate on it.
                  const canServe = f.streamable !== false;
                  return (
                    <div
                      key={`${folder}-${i}`}
                      className="flex items-center gap-2 rounded-md border border-[--border]/60 px-2.5 py-1.5"
                    >
                      <BiFile className="text-[--muted] shrink-0" />
                      {/* break-all (not truncate) so the full name always shows,
                          wrapping on narrow screens; items-center keeps the icon,
                          type, size and actions centred as the row grows. */}
                      <span className="flex-1 text-sm break-all">
                        {basename(f)}
                      </span>
                      {f.category && (
                        <span className="text-xs text-[--muted] shrink-0">
                          {f.category}
                        </span>
                      )}
                      <span className="text-xs tabular-nums text-[--muted] w-20 text-right shrink-0">
                        {formatBytes(f.size)}
                      </span>
                      <div className="flex items-center gap-1 shrink-0">
                        <Tooltip
                          trigger={
                            <IconButton
                              size="sm"
                              intent="primary-subtle"
                              icon={<BiPlay />}
                              aria-label="Preview"
                              disabled={!canServe}
                              className={cn(!canServe && 'opacity-40')}
                              onClick={() => openUrl(f, false)}
                            />
                          }
                        >
                          {canServe ? 'Preview' : 'Not individually streamable'}
                        </Tooltip>
                        <Tooltip
                          trigger={
                            <IconButton
                              size="sm"
                              intent="gray-subtle"
                              icon={<BiDownload />}
                              aria-label="Download"
                              disabled={!canServe}
                              className={cn(!canServe && 'opacity-40')}
                              onClick={() => openUrl(f, true)}
                            />
                          }
                        >
                          {canServe
                            ? 'Download'
                            : 'Not individually streamable'}
                        </Tooltip>
                        <Tooltip
                          trigger={
                            <IconButton
                              size="sm"
                              intent="gray-subtle"
                              icon={<BiLink />}
                              aria-label="Copy download link"
                              disabled={!canServe}
                              className={cn(!canServe && 'opacity-40')}
                              onClick={() => copyLink(f)}
                            />
                          }
                        >
                          Copy download link
                        </Tooltip>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </Modal>
  );
}
