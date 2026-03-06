'use client';
import React, { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { Modal } from '../../ui/modal';
import { Skeleton } from '../../ui/skeleton/skeleton';
import {
  fetchAndParseChangelog,
  type ChangelogEntry,
} from '@/lib/templates/changelog';
import { compareVersions } from '@/lib/templates/storage';
import type { AppliedTemplateUpdate } from '@/hooks/templates/loader';

export function ChangelogEntryRow({ entry }: { entry: ChangelogEntry }) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-bold text-[--brand]">
          v{entry.version}
        </span>
        <span className="text-[10px] font-medium px-2.5 py-0.5 rounded-full bg-gray-700/60 text-gray-400 border border-gray-600/40 flex-shrink-0">
          {entry.date}
        </span>
      </div>
      <div className="prose prose-invert prose-sm max-w-none min-w-0 text-gray-300 [&_p]:leading-relaxed [&_ul]:space-y-0.5 [&_li]:text-sm [&_p]:text-sm [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_strong]:text-gray-100 [&_a]:text-[--brand] [&_a:hover]:underline [&_code]:bg-gray-800 [&_code]:px-1 [&_code]:rounded [&_code]:text-[--brand] [&_code]:text-xs [&_*]:break-words [&_pre]:overflow-x-auto [&_pre]:max-w-full">
        <ReactMarkdown>{entry.content}</ReactMarkdown>
      </div>
    </div>
  );
}

export function ChangelogLoadingSkeleton() {
  return (
    <div className="space-y-3 py-2">
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-4 w-24 rounded-full" />
      </div>
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-5/6" />
      <Skeleton className="h-3 w-4/6" />
    </div>
  );
}

export function ChangelogEntriesList({
  entries,
}: {
  entries: ChangelogEntry[];
}) {
  return (
    <div className="divide-y divide-gray-700/50">
      {entries.map((entry) => (
        <div key={entry.version} className="py-4 first:pt-1 last:pb-1">
          <ChangelogEntryRow entry={entry} />
        </div>
      ))}
    </div>
  );
}

interface TemplateChangelogModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templateName: string;
  /** Inline entries from the template JSON. */
  changelog?: ChangelogEntry[];
  /** Remote CHANGELOG.md URL — fetched and cached on first open. */
  changelogUrl?: string;
}

export function TemplateChangelogModal({
  open,
  onOpenChange,
  templateName,
  changelog = [],
  changelogUrl,
}: TemplateChangelogModalProps) {
  const [fetchedEntries, setFetchedEntries] = useState<ChangelogEntry[] | null>(
    null
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch remote changelog when modal first opens
  useEffect(() => {
    if (!open || !changelogUrl) return;
    if (fetchedEntries !== null) return; // already loaded (cache hit or fetched)
    setLoading(true);
    setError(null);
    fetchAndParseChangelog(changelogUrl)
      .then(setFetchedEntries)
      .catch((err) => {
        console.error('Failed to load changelog:', err);
        setError('Failed to load changelog. Please try again later.');
        setFetchedEntries([]);
      })
      .finally(() => setLoading(false));
  }, [open, changelogUrl]);

  // URL entries take precedence; fall back to inline
  const entries: ChangelogEntry[] = changelogUrl
    ? (fetchedEntries ?? [])
    : changelog;

  const renderBody = () => {
    if (loading) return <ChangelogLoadingSkeleton />;
    if (error)
      return <p className="text-sm text-red-400 italic py-2">{error}</p>;
    if (entries.length === 0)
      return (
        <p className="text-sm text-gray-500 italic py-2">
          No changelog available.
        </p>
      );
    return (
      <div className="max-h-[60vh] overflow-y-auto pr-4 -mr-2">
        <ChangelogEntriesList entries={entries} />
      </div>
    );
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`Changelog — ${templateName}`}
      contentClass="max-w-2xl"
    >
      {renderBody()}
    </Modal>
  );
}

/**
 * Fetches a template's changelog from `changelogUrl`, filters to entries
 * newer than `update.appliedVersion`, and renders them.
 * Used inside the "Template Updates Available" modal in the About page.
 */
export function TemplateUpdateChangelogSection({
  update,
}: {
  update: AppliedTemplateUpdate;
}) {
  const [entries, setEntries] = useState<ChangelogEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changelogUrl = update.template.metadata.changelogUrl;

  useEffect(() => {
    if (!changelogUrl) return;
    setLoading(true);
    fetchAndParseChangelog(changelogUrl)
      .then((all) => {
        const newer = all.filter(
          (e) => compareVersions(e.version, update.appliedVersion) > 0
        );
        setEntries(newer);
      })
      .catch((err) => {
        console.error('Failed to load template changelog:', err);
        setError('Failed to load changelog.');
        setEntries([]);
      })
      .finally(() => setLoading(false));
  }, [changelogUrl, update.appliedVersion]);

  if (loading) return <ChangelogLoadingSkeleton />;
  if (error) return <p className="text-xs text-red-400 italic">{error}</p>;
  if (!entries || entries.length === 0)
    return (
      <p className="text-xs text-gray-500 italic">
        No changelog provided for this update.
      </p>
    );

  return (
    <div className="divide-y divide-gray-700/50">
      {entries.map((entry) => (
        <div key={entry.version} className="py-3 first:pt-1 last:pb-1">
          <ChangelogEntryRow entry={entry} />
        </div>
      ))}
    </div>
  );
}
