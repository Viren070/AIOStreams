import React, { useState } from 'react';
import type { CommunityItem, TemplateReviewSummary } from '@aiostreams/core';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Pill } from '@/app/dashboard/streams/_components/shared';

export function KindPill({ kind }: { kind: CommunityItem['kind'] }) {
  return (
    <Pill
      className={
        kind === 'template'
          ? 'border-purple-500/30 bg-purple-500/10 text-purple-300'
          : 'border-sky-500/30 bg-sky-500/10 text-sky-300'
      }
    >
      {kind}
    </Pill>
  );
}

export function TagList({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((tag) => (
        <Pill key={tag}>{tag}</Pill>
      ))}
    </div>
  );
}

/** A formatter's two templates, or a template's config as JSON. */
export function PayloadView({
  kind,
  payload,
}: {
  kind: CommunityItem['kind'];
  payload: unknown;
}) {
  const [open, setOpen] = useState(kind === 'formatter');
  if (kind === 'formatter') {
    const def = (payload ?? {}) as { name?: string; description?: string };
    return (
      <div className="space-y-2 text-xs">
        <div>
          <p className="mb-1 uppercase tracking-wide text-[--muted]">Name</p>
          <pre className="whitespace-pre-wrap break-words rounded border border-[--border] bg-[--subtle]/40 p-2">
            {def.name}
          </pre>
        </div>
        <div>
          <p className="mb-1 uppercase tracking-wide text-[--muted]">
            Description
          </p>
          <pre className="whitespace-pre-wrap break-words rounded border border-[--border] bg-[--subtle]/40 p-2">
            {def.description}
          </pre>
        </div>
      </div>
    );
  }
  return (
    <div className="text-xs">
      <button
        type="button"
        className="text-[--brand] hover:underline"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? 'Hide' : 'Show'} template JSON
      </button>
      {open && (
        <pre className="mt-2 max-h-96 overflow-auto whitespace-pre rounded border border-[--border] bg-[--subtle]/40 p-2">
          {JSON.stringify(payload, null, 2)}
        </pre>
      )}
    </div>
  );
}

/**
 * What approving a template would let through: where its addons point (a
 * non-default host receives the user's service credentials) and what trust
 * would whitelist for everyone.
 */
export function ReviewSummaryView({
  summary,
}: {
  summary: TemplateReviewSummary;
}) {
  const flagged = summary.presets.filter((p) =>
    p.urlOptions.some((o) => o.differsFromDefault)
  );
  return (
    <div className="space-y-3 rounded border border-[--border] bg-[--subtle]/30 p-3 text-xs">
      <div>
        <p className="mb-1 uppercase tracking-wide text-[--muted]">Addons</p>
        {!summary.presetsInspected ? (
          <p className="text-yellow-300">
            The addon list is a template directive, so it could not be
            inspected. Read the JSON below.
          </p>
        ) : summary.presets.length === 0 ? (
          <p className="text-[--muted]">No addons.</p>
        ) : (
          <ul className="space-y-1">
            {summary.presets.map((preset, i) => (
              <li
                key={`${preset.type}-${i}`}
                className="flex flex-wrap gap-x-2"
              >
                <span className="font-medium">
                  {preset.name ?? preset.type}
                </span>
                <span className="text-[--muted]">({preset.type})</span>
                {preset.urlOptions.map((o) => (
                  <span
                    key={o.id}
                    className={
                      o.differsFromDefault
                        ? 'font-mono text-red-200'
                        : 'font-mono text-[--muted]'
                    }
                  >
                    {o.id}={o.value}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        )}
        {flagged.length > 0 && (
          <p className="mt-1 text-red-200">
            {flagged.length} addon{flagged.length === 1 ? '' : 's'} point at a
            non-default host. Those hosts may receive the service credentials of
            anyone who applies this template.
          </p>
        )}
      </div>
      {summary.changelogUrl && (
        <div>
          <p className="mb-1 uppercase tracking-wide text-[--muted]">
            Changelog URL
          </p>
          <p className="break-all font-mono">{summary.changelogUrl}</p>
          <p className="text-[--muted]">
            Fetched by users&rsquo; browsers when they open the changelog; the
            author can change its contents at any time.
          </p>
        </div>
      )}
      <div>
        <p className="mb-1 uppercase tracking-wide text-[--muted]">
          Regex patterns ({summary.regexPatterns.length})
        </p>
        {summary.regexPatterns.length === 0 ? (
          <p className="text-[--muted]">None.</p>
        ) : (
          <ul className="max-h-40 space-y-0.5 overflow-auto font-mono">
            {summary.regexPatterns.map((p, i) => (
              <li key={i} className="break-all">
                {p}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <p className="mb-1 uppercase tracking-wide text-[--muted]">
          Synced URLs ({summary.syncedUrls.length})
        </p>
        {summary.syncedUrls.length === 0 ? (
          <p className="text-[--muted]">None.</p>
        ) : (
          <ul className="max-h-40 space-y-0.5 overflow-auto font-mono">
            {summary.syncedUrls.map((u, i) => (
              <li key={i} className="break-all">
                {u}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <p className="mb-1 uppercase tracking-wide text-[--muted]">
          Variant scripts ({summary.variantScripts?.length ?? 0})
        </p>
        {!summary.variantScripts?.length ? (
          <p className="text-[--muted]">None.</p>
        ) : (
          <div className="max-h-60 space-y-2 overflow-auto">
            {summary.variantScripts.map((variant) => (
              <div key={variant.id}>
                <p className="font-medium">
                  {variant.name ?? variant.id}{' '}
                  <span className="text-[--muted]">({variant.id})</span>
                </p>
                <pre className="whitespace-pre-wrap break-all font-mono text-[--muted]">
                  {variant.script}
                </pre>
              </div>
            ))}
            <p className="text-[--muted]">Stored as written.</p>
          </div>
        )}
      </div>
    </div>
  );
}

/** Confirm an action with a required reason. */
export function ReasonModal({
  open,
  onOpenChange,
  title,
  actionText,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  actionText: string;
  pending: boolean;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title}>
      <div className="space-y-4">
        <Textarea
          value={reason}
          onValueChange={setReason}
          placeholder="The uploader sees this reason."
          maxLength={500}
        />
        <div className="flex justify-end gap-2">
          <Button
            intent="gray-outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            intent="alert"
            size="sm"
            disabled={!reason.trim()}
            loading={pending}
            onClick={() => {
              onConfirm(reason.trim());
              setReason('');
            }}
          >
            {actionText}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
