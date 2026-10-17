import React from 'react';
import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { toast } from 'sonner';
import { useQueries } from '@tanstack/react-query';
import {
  BiChevronDown,
  BiChevronUp,
  BiEditAlt,
  BiPlus,
  BiTrash,
} from 'react-icons/bi';
import { Button, IconButton } from '@aiostreams/ui/button';
import { Modal } from '@aiostreams/ui/modal';
import { TextInput } from '@aiostreams/ui/text-input';
import { Textarea } from '@aiostreams/ui/textarea';
import { Combobox } from '@aiostreams/ui/combobox';
import { ColorInput } from '@aiostreams/ui/color-input';
import { cn } from '@aiostreams/ui/core/styling';
import { copyToClipboard } from '@aiostreams/ui/utils/clipboard';
import { currentHost } from '../lib/hosts';
import { useRestoreFocus } from '../lib/input';
import { formatLocale } from '../lib/i18n';
import { useFeature } from '../lib/server-info';
import { settings, useSetting } from '../lib/settings';
import {
  compileQuery,
  readQuickFilterData,
  toRegExp,
  versionText,
  VERSION_FIELDS,
  type QuickFilter,
  type VersionField,
} from '../lib/versions';
import {
  compileBadges,
  matchBadges,
  readBadges,
  type Badge,
  type BadgeSettings,
} from '../lib/badges';
import { SettingsRow } from './settings-card';
import { BadgeChip, badgePackQuery } from './version-badges';

const DOCS = 'https://docs.aiostreams.viren070.me/reference/version-badges';

const names = (list: string[]) =>
  new Intl.ListFormat(formatLocale(), { type: 'conjunction' }).format(list);

function moved<T>(list: T[], from: number, by: -1 | 1): T[] {
  const to = from + by;
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

function EditButton({ onClick }: { onClick: () => void }) {
  // Typing patterns with a remote is not worth it; these follow the account.
  if (currentHost().tv) return null;
  return (
    <Button
      intent="gray-outline"
      size="sm"
      className="w-full rounded-full sm:w-auto"
      onClick={onClick}
    >
      <Trans>Edit</Trans>
    </Button>
  );
}

function TvNote() {
  if (!currentHost().tv) return null;
  return (
    <span className="block">
      <Trans>Change these on a phone, a computer or in a browser.</Trans>
    </span>
  );
}

function RowActions({
  index,
  count,
  onMove,
  onRemove,
  onEdit,
}: {
  index: number;
  count: number;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
  onEdit?: () => void;
}) {
  return (
    <div className="flex flex-none items-center gap-1">
      {onEdit && (
        <IconButton
          size="sm"
          intent="gray-subtle"
          className="rounded-full"
          icon={<BiEditAlt />}
          aria-label={t`Edit`}
          onClick={onEdit}
        />
      )}
      <IconButton
        size="sm"
        intent="gray-subtle"
        className="rounded-full"
        icon={<BiChevronUp />}
        aria-label={t`Move up`}
        disabled={index === 0}
        onClick={() => onMove(-1)}
      />
      <IconButton
        size="sm"
        intent="gray-subtle"
        className="rounded-full"
        icon={<BiChevronDown />}
        aria-label={t`Move down`}
        disabled={index === count - 1}
        onClick={() => onMove(1)}
      />
      <IconButton
        size="sm"
        intent="alert-subtle"
        className="rounded-full"
        icon={<BiTrash />}
        aria-label={t`Remove`}
        onClick={onRemove}
      />
    </div>
  );
}

export function QuickFiltersRow() {
  const [filters] = useSetting(settings.playback.quickFilters);
  const [open, setOpen] = React.useState(false);
  const list = names(filters.map((f) => f.name));
  return (
    <>
      <SettingsRow
        label={t`Quick filters`}
        help={
          <>
            {filters.length
              ? list
              : t`Pills above the version list that each apply a search you save, such as one for 4K versions.`}
            <TvNote />
          </>
        }
      >
        <EditButton onClick={() => setOpen(true)} />
      </SettingsRow>
      <QuickFiltersModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}

const blankFilter = (): QuickFilter => ({ name: '', query: '' });

function QuickFiltersModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [saved, save] = useSetting(settings.playback.quickFilters);
  const [draft, setDraft] = React.useState<QuickFilter[]>([]);
  const [pasted, setPasted] = React.useState('');
  const [importError, setImportError] = React.useState<string>();
  const [importing, setImporting] = React.useState(false);
  const hasFields = useFeature('versions');
  const restoreFocus = useRestoreFocus(open);
  React.useEffect(() => {
    if (!open) return;
    setDraft(saved.length ? saved : [blankFilter()]);
    setPasted('');
    setImportError(undefined);
    // Only a fresh opening starts over from what is saved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const change = (index: number, patch: Partial<QuickFilter>) =>
    setDraft((list) =>
      list.map((f, i) => (i === index ? { ...f, ...patch } : f))
    );
  const done = () => {
    save(draft);
    onClose();
  };
  const importFilters = async () => {
    const text = pasted.trim();
    let data: unknown;
    setImporting(true);
    try {
      data = /^https?:\/\/\S+$/i.test(text)
        ? await (await fetch(text, { cache: 'no-cache' })).json()
        : JSON.parse(text);
    } catch {
      data = null;
    } finally {
      setImporting(false);
    }
    const found = readQuickFilterData(data);
    if (!found.length) {
      setImportError(t`That has no quick filters this app can read.`);
      return;
    }
    const count = found.length;
    setDraft((list) => [
      ...list.filter((f) => f.name.trim() || f.query.trim()),
      ...found,
    ]);
    setPasted('');
    setImportError(undefined);
    toast.success(
      plural(count, {
        one: 'Added # quick filter',
        other: 'Added # quick filters',
      })
    );
  };
  return (
    <Modal
      data-ui="dialog"
      data-name="quick-filters"
      open={open}
      onOpenChange={(next) => !next && onClose()}
      onCloseAutoFocus={restoreFocus}
      title={t`Quick filters`}
      description={
        <>
          <Trans>
            Each filter shows as a pill above the version list. Its search is
            words that must all appear, or a regular expression between slashes,
            such as /2160p|4k/. Case never matters.
          </Trans>
          {hasFields ? (
            <>
              {' '}
              <Trans>
                Pick fields to search only those parts of a version.
              </Trans>
            </>
          ) : null}
        </>
      }
      contentClass="max-w-2xl"
    >
      <div className="space-y-3">
        {draft.map((filter, index) => {
          const invalid = !!filter.query.trim() && !compileQuery(filter.query);
          return (
            <div
              key={index}
              data-ui="quick-filter"
              className="space-y-2 rounded-xl border border-white/10 p-3"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                <div className="sm:w-40 sm:flex-none">
                  <TextInput
                    aria-label={t`Name`}
                    placeholder={t`Name`}
                    value={filter.name}
                    onValueChange={(name) => change(index, { name })}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <TextInput
                    aria-label={t`Search`}
                    placeholder={t`Words or /pattern/`}
                    value={filter.query}
                    onValueChange={(query) => change(index, { query })}
                    error={
                      invalid
                        ? t`That is not a valid regular expression.`
                        : undefined
                    }
                    className="font-mono text-sm"
                  />
                </div>
                <RowActions
                  index={index}
                  count={draft.length}
                  onMove={(by) => setDraft((list) => moved(list, index, by))}
                  onRemove={() =>
                    setDraft((list) => list.filter((_, i) => i !== index))
                  }
                />
              </div>
              {hasFields ? (
                <FieldsPicker
                  value={filter.fields}
                  onValueChange={(fields) => change(index, { fields })}
                />
              ) : null}
            </div>
          );
        })}
        <Button
          intent="gray-outline"
          size="sm"
          className="rounded-full"
          leftIcon={<BiPlus />}
          onClick={() => setDraft((list) => [...list, blankFilter()])}
        >
          <Trans>Add a filter</Trans>
        </Button>
        <section data-ui="quick-filter-import" className="space-y-2 pt-3">
          <Textarea
            label={t`Import`}
            help={t`Paste quick filters as JSON, or the address of a file with them, to add them to these.`}
            value={pasted}
            onValueChange={setPasted}
            error={importError}
            className="min-h-20 font-mono text-xs"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              intent="gray-outline"
              size="sm"
              className="rounded-full"
              disabled={!pasted.trim()}
              loading={importing}
              onClick={() => void importFilters()}
            >
              <Trans>Import</Trans>
            </Button>
            <CopyButton
              json={{
                quickFilters: draft.filter(
                  (f) => f.name.trim() && f.query.trim()
                ),
              }}
            />
          </div>
        </section>
      </div>
      <ModalFooter onCancel={onClose} onSave={done} />
    </Modal>
  );
}

function CopyButton({ json }: { json: object }) {
  return (
    <Button
      intent="gray-outline"
      size="sm"
      className="rounded-full"
      onClick={() =>
        void copyToClipboard(JSON.stringify(json, null, 2), {
          onSuccess: () => toast.success(t`Copied as JSON`),
          onError: () => toast.error(t`Could not copy them`),
        })
      }
    >
      <Trans>Copy as JSON</Trans>
    </Button>
  );
}

function FieldsPicker({
  label,
  help,
  value,
  onValueChange,
}: {
  label?: string;
  help?: string;
  value: VersionField[] | undefined;
  onValueChange: (fields: VersionField[]) => void;
}) {
  return (
    <Combobox
      multiple
      label={label}
      help={help}
      aria-label={label ? undefined : t`Fields`}
      placeholder={t`All fields`}
      emptyMessage={t`Nothing matches.`}
      options={VERSION_FIELDS.map((field) => ({
        value: field,
        label: field,
        textValue: field,
      }))}
      value={value ?? []}
      onValueChange={(fields) => onValueChange(fields as VersionField[])}
    />
  );
}

function ModalFooter({
  onCancel,
  onSave,
}: {
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:items-center">
      <a
        href={DOCS}
        target="_blank"
        rel="noreferrer"
        className="text-sm text-[--muted] underline-offset-4 hover:text-white hover:underline sm:me-auto"
      >
        <Trans>How these work</Trans>
      </a>
      <Button intent="gray-outline" className="rounded-full" onClick={onCancel}>
        <Trans>Cancel</Trans>
      </Button>
      <Button intent="white" className="rounded-full" onClick={onSave}>
        <Trans>Save</Trans>
      </Button>
    </div>
  );
}

export function BadgesRow() {
  const [{ links, badges }] = useSetting(settings.playback.badges);
  const [open, setOpen] = React.useState(false);
  const packCount = links.length;
  const badgeCount = badges.length;
  const packs = plural(packCount, { one: '# pack', other: '# packs' });
  const own = plural(badgeCount, {
    one: '# badge of your own',
    other: '# badges of your own',
  });
  const summary =
    packCount && badgeCount
      ? t`${packs} and ${own}`
      : packCount
        ? packs
        : badgeCount
          ? own
          : t`Small labels on each version for what it has, from packs you link or badges you make.`;
  return (
    <>
      <SettingsRow
        label={t`Badges`}
        help={
          <>
            {summary}
            <TvNote />
          </>
        }
      >
        <EditButton onClick={() => setOpen(true)} />
      </SettingsRow>
      <BadgesModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}

const blankBadge = (): Badge => ({ label: '', match: '' });

function BadgesModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [saved, save] = useSetting(settings.playback.badges);
  const [draft, setDraft] = React.useState<BadgeSettings>(saved);
  const [editing, setEditing] = React.useState<number | null>(null);
  const [address, setAddress] = React.useState('');
  const [pasted, setPasted] = React.useState('');
  const [importError, setImportError] = React.useState<string>();
  const [sample, setSample] = React.useState('');
  const restoreFocus = useRestoreFocus(open);
  React.useEffect(() => {
    if (!open) return;
    setDraft(saved);
    setEditing(null);
    setAddress('');
    setPasted('');
    setImportError(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const packs = useQueries({ queries: draft.links.map(badgePackQuery) });
  const tried = React.useMemo(() => {
    if (!sample.trim()) return [];
    const compiled = compileBadges([
      ...draft.badges,
      ...packs.flatMap((p) => p.data ?? []),
    ]);
    return matchBadges(
      versionText({ aiostreams: undefined, Name: sample }),
      compiled
    );
  }, [sample, draft.badges, packs]);

  const setBadges = (badges: Badge[]) => setDraft((d) => ({ ...d, badges }));
  const addLink = () => {
    const url = address.trim();
    if (!/^https?:\/\//i.test(url)) return;
    if (!draft.links.includes(url))
      setDraft((d) => ({ ...d, links: [...d.links, url] }));
    setAddress('');
  };
  const importPasted = () => {
    const text = pasted.trim();
    if (/^https?:\/\/\S+$/i.test(text)) {
      setDraft((d) =>
        d.links.includes(text) ? d : { ...d, links: [...d.links, text] }
      );
      setPasted('');
      setImportError(undefined);
      return;
    }
    let found: Badge[] | null = null;
    try {
      found = readBadges(JSON.parse(text));
    } catch {}
    if (!found?.length) {
      setImportError(t`That has no badges this app can read.`);
      return;
    }
    const count = found.length;
    setBadges([...draft.badges, ...found]);
    setPasted('');
    setImportError(undefined);
    toast.success(
      plural(count, { one: 'Added # badge', other: 'Added # badges' })
    );
  };
  const done = () => {
    save({
      links: draft.links,
      badges: draft.badges.filter((b) => b.label.trim() && b.match.trim()),
    });
    onClose();
  };

  return (
    <Modal
      data-ui="dialog"
      data-name="badges"
      open={open}
      onOpenChange={(next) => !next && onClose()}
      onCloseAutoFocus={restoreFocus}
      title={t`Badges`}
      description={
        <Trans>
          A badge shows on each version whose text matches its pattern: the name
          and description your formatter writes, the file name, and the tags
          read from it.
        </Trans>
      }
      contentClass="max-w-3xl"
    >
      <div className="space-y-6">
        <section data-ui="badge-packs" className="space-y-2">
          <p className="font-semibold">
            <Trans>Packs</Trans>
          </p>
          <p className="text-sm text-[--muted]">
            <Trans>
              Link a pack someone shares, in this app's format or the one Fusion
              and Nuvio use. It stays up to date with its author's changes.
            </Trans>
          </p>
          {draft.links.map((url, index) => {
            const pack = packs[index];
            const count = pack?.data?.length ?? 0;
            const failure = pack?.error?.message ?? '';
            return (
              <div
                key={url}
                data-ui="badge-pack"
                className="flex items-center gap-2 rounded-xl border border-white/10 p-2 ps-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{url}</p>
                  <p
                    className={cn(
                      'text-xs',
                      pack?.error ? 'text-red-300' : 'text-[--muted]'
                    )}
                  >
                    {pack?.isPending
                      ? t`Loading…`
                      : pack?.error
                        ? failure
                        : plural(count, {
                            one: '# badge',
                            other: '# badges',
                          })}
                  </p>
                </div>
                <RowActions
                  index={index}
                  count={draft.links.length}
                  onMove={(by) =>
                    setDraft((d) => ({
                      ...d,
                      links: moved(d.links, index, by),
                    }))
                  }
                  onRemove={() =>
                    setDraft((d) => ({
                      ...d,
                      links: d.links.filter((l) => l !== url),
                    }))
                  }
                />
              </div>
            );
          })}
          <div className="flex gap-2">
            <div className="min-w-0 flex-1">
              <TextInput
                aria-label={t`Pack address`}
                placeholder="https://"
                value={address}
                onValueChange={setAddress}
                onKeyDown={(e) => e.key === 'Enter' && addLink()}
              />
            </div>
            <Button
              intent="white"
              className="rounded-full"
              disabled={!/^https?:\/\/\S+$/i.test(address.trim())}
              onClick={addLink}
            >
              <Trans>Add</Trans>
            </Button>
          </div>
        </section>

        <section data-ui="own-badges" className="space-y-2">
          <p className="font-semibold">
            <Trans>Your badges</Trans>
          </p>
          <p className="text-sm text-[--muted]">
            <Trans>
              These come before the packs' badges. Badges that share a group are
              alternatives: only the first that matches shows.
            </Trans>
          </p>
          {draft.badges.map((badge, index) =>
            editing === index ? (
              <BadgeForm
                key={index}
                badge={badge}
                onChange={(next) =>
                  setBadges(
                    draft.badges.map((b, i) => (i === index ? next : b))
                  )
                }
                onDone={() => setEditing(null)}
              />
            ) : (
              <div
                key={index}
                data-ui="own-badge"
                className="flex items-center gap-3 rounded-xl border border-white/10 p-2 ps-3"
              >
                {badge.label && badge.match ? (
                  <BadgeChip badge={badge} />
                ) : (
                  <span className="text-sm text-[--muted]">
                    <Trans>Unfinished</Trans>
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{badge.label}</p>
                  <p className="truncate font-mono text-xs text-[--muted]">
                    {badge.match}
                  </p>
                </div>
                <RowActions
                  index={index}
                  count={draft.badges.length}
                  onEdit={() => setEditing(index)}
                  onMove={(by) => setBadges(moved(draft.badges, index, by))}
                  onRemove={() => {
                    setBadges(draft.badges.filter((_, i) => i !== index));
                    setEditing(null);
                  }}
                />
              </div>
            )
          )}
          <Button
            intent="gray-outline"
            size="sm"
            className="rounded-full"
            leftIcon={<BiPlus />}
            onClick={() => {
              setBadges([...draft.badges, blankBadge()]);
              setEditing(draft.badges.length);
            }}
          >
            <Trans>Add a badge</Trans>
          </Button>
        </section>

        <section data-ui="badge-import" className="space-y-2">
          <Textarea
            label={t`Import`}
            help={t`Paste badges as JSON to add them to yours, or paste a pack's address to link it.`}
            value={pasted}
            onValueChange={setPasted}
            error={importError}
            className="min-h-24 font-mono text-xs"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              intent="gray-outline"
              size="sm"
              className="rounded-full"
              disabled={!pasted.trim()}
              onClick={importPasted}
            >
              <Trans>Import</Trans>
            </Button>
            <CopyButton
              json={{
                badges: draft.badges.filter(
                  (b) => b.label.trim() && b.match.trim()
                ),
              }}
            />
          </div>
        </section>

        <section data-ui="badge-try" className="space-y-2">
          <TextInput
            label={t`Try them`}
            help={t`Type a release name to see the badges it gets.`}
            value={sample}
            onValueChange={setSample}
          />
          {!!sample.trim() && (
            <div className="flex min-h-6 flex-wrap gap-1">
              {tried.length ? (
                tried.map((badge) => (
                  <BadgeChip key={badge.image ?? badge.label} badge={badge} />
                ))
              ) : (
                <span className="text-sm text-[--muted]">
                  <Trans>No badges match.</Trans>
                </span>
              )}
            </div>
          )}
        </section>
      </div>
      <ModalFooter onCancel={onClose} onSave={done} />
    </Modal>
  );
}

const colorFields = () =>
  [
    ['color', t`Text`],
    ['background', t`Background`],
    ['border', t`Border`],
  ] as const;

const OPTIONAL = [
  'image',
  'color',
  'background',
  'border',
  'group',
  'fields',
] as const;

function BadgeForm({
  badge,
  onChange,
  onDone,
}: {
  badge: Badge;
  onChange: (badge: Badge) => void;
  onDone: () => void;
}) {
  const set = (patch: Partial<Badge>) => {
    const next: Badge = { ...badge, ...patch };
    for (const key of OPTIONAL)
      if (!next[key] || next[key].length === 0) delete next[key];
    onChange(next);
  };
  const invalid = !!badge.match.trim() && !toRegExp(badge.match);
  const hasFields = useFeature('versions');
  return (
    <div
      data-ui="badge-form"
      className="space-y-3 rounded-xl border border-white/20 p-3"
    >
      <div className="flex items-center gap-3">
        <span className="text-sm text-[--muted]">
          <Trans>Preview</Trans>
        </span>
        {badge.label ? <BadgeChip badge={badge} /> : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextInput
          label={t`Label`}
          value={badge.label}
          onValueChange={(label) => set({ label })}
        />
        <TextInput
          label={t`Group`}
          help={t`Optional. Only the first badge of a group that matches shows.`}
          value={badge.group ?? ''}
          onValueChange={(group) => set({ group })}
        />
      </div>
      <TextInput
        label={t`Pattern`}
        help={t`A regular expression. Case never matters.`}
        value={badge.match}
        onValueChange={(match) => set({ match })}
        error={invalid ? t`That is not a valid regular expression.` : undefined}
        className="font-mono text-sm"
      />
      {hasFields ? (
        <FieldsPicker
          label={t`Fields`}
          help={t`Optional. Match only these parts of a version, named as the formatter names them, such as seMatched for the stream expression it matched.`}
          value={badge.fields}
          onValueChange={(fields) => set({ fields })}
        />
      ) : null}
      <TextInput
        label={t`Image`}
        help={t`Optional. An image address, shown in place of the label.`}
        placeholder="https://"
        value={badge.image ?? ''}
        onValueChange={(image) => set({ image })}
      />
      <div className="space-y-3">
        {colorFields().map(([key, label]) => (
          <ColorInput
            key={key}
            allowEmpty
            label={label}
            placeholder={t`Default`}
            value={badge[key] ?? ''}
            onValueChange={(value) => set({ [key]: value } as Partial<Badge>)}
          />
        ))}
      </div>
      <Button
        intent="gray-outline"
        size="sm"
        className="rounded-full"
        onClick={onDone}
      >
        <Trans>Done</Trans>
      </Button>
    </div>
  );
}
