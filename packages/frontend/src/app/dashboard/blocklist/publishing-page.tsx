import React from 'react';
import { toast } from 'sonner';
import { useMutation } from '@tanstack/react-query';
import {
  BiCopy,
  BiInfoCircle,
  BiPencil,
  BiPlus,
  BiTrash,
  BiUpload,
} from 'react-icons/bi';
import { Card } from '@/components/ui/card';
import { Button, IconButton } from '@/components/ui/button';
import { TextInput } from '@/components/ui/text-input';
import { Textarea } from '@/components/ui/textarea';
import { NumberInput } from '@/components/ui/number-input';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Modal } from '@/components/ui/modal';
import { Popover } from '@/components/ui/popover';
import {
  ConfirmationDialog,
  useConfirmationDialog,
} from '@/components/shared/confirmation-dialog';
import { DashboardQueryBoundary } from '@/components/shared/dashboard-query-boundary';
import { api } from '@/lib/api';
import { copyToClipboard } from '@/utils/clipboard';
import { useStatus } from '@/context/status';
import {
  Badge,
  formatInterval,
  formatUnix,
  useBlocklistSnapshot,
  useInvalidateBlocklist,
  type PublishFormat,
  type PublishProviderField,
  type PublishProviderInfo,
  type PublishScope,
  type PublishTargetView,
  type Snapshot,
} from './shared';
import { Alert } from '@/components/ui/alert';

const PROVIDER_BADGE = 'bg-sky-500/10 text-sky-500 border-sky-500/20';

interface ArtifactDraft {
  format: PublishFormat;
  scope: PublishScope;
  gzip: boolean;
}

/** One published file, from a push target or from the live public export. */
interface PublishFile {
  key: string;
  format: PublishFormat;
  scope: PublishScope;
  gzip: boolean;
  /** What the file is called (a filename, or the export path for this instance). */
  label: string;
  url: string | null;
  pushedAt: number | null;
}

const SCOPE_TEXT: Record<PublishScope, string> = {
  local: 'Own verdicts',
  all: 'Every source',
};

function describeFile(file: PublishFile): string {
  const parts = [SCOPE_TEXT[file.scope]];
  if (file.format === 'warden') parts.push('Warden format');
  if (file.gzip) parts.push('gzip');
  if (file.pushedAt) parts.push(`pushed ${formatUnix(file.pushedAt)}`);
  return parts.join(' · ');
}

function sortFiles(files: PublishFile[]): PublishFile[] {
  const rank = (f: PublishFile) =>
    (f.format === 'native' ? 0 : 2) + (f.scope === 'local' ? 0 : 1);
  return [...files].sort((a, b) => rank(a) - rank(b));
}

function targetFiles(target: PublishTargetView): PublishFile[] {
  return target.artifacts.map((artifact) => ({
    key: `${artifact.format}:${artifact.scope}`,
    format: artifact.format,
    scope: artifact.scope,
    gzip: artifact.gzip,
    label: artifact.filename,
    url: artifact.url,
    pushedAt: artifact.pushedAt,
  }));
}

/** The four /blocklist/export variants; the password stays out of the label. */
function publicExportFiles(
  settings: Snapshot['settings'],
  baseUrl: string
): PublishFile[] {
  const files: PublishFile[] = [];
  const scopes: PublishScope[] =
    settings.publicExportScope === 'all' ? ['local', 'all'] : ['local'];
  for (const scope of scopes) {
    for (const format of ['native', 'warden'] as const) {
      const visible = new URLSearchParams();
      if (scope === 'all') visible.set('scope', 'all');
      if (format === 'warden') visible.set('format', 'warden');
      const params = new URLSearchParams(visible);
      if (settings.publicExportPassword) {
        params.set('key', settings.publicExportPassword);
      }
      const suffix = (search: URLSearchParams) => {
        const query = search.toString();
        return query ? `?${query}` : '';
      };
      files.push({
        key: `${format}:${scope}`,
        format,
        scope,
        gzip: false,
        label: `/blocklist/export${suffix(visible)}`,
        url: `${baseUrl}/blocklist/export${suffix(params)}`,
        pushedAt: null,
      });
    }
  }
  return files;
}

export function BlocklistPublishingPage() {
  const snapshotQuery = useBlocklistSnapshot();
  const invalidate = useInvalidateBlocklist();

  return (
    <DashboardQueryBoundary
      query={snapshotQuery}
      errorTitle="Failed to load the blocklist"
    >
      {(snapshot) => (
        <PublishingView snapshot={snapshot} invalidate={invalidate} />
      )}
    </DashboardQueryBoundary>
  );
}

function copyText(text: string) {
  copyToClipboard(text, {
    onSuccess: () => toast.success('Copied to clipboard'),
    onError: () => toast.error('Failed to copy'),
  });
}

/**
 * The status cell: the outcome at a glance, with a failure's full reason a
 * click away so a long provider error cannot blow out the row.
 */
function StatusCell({ target }: { target: PublishTargetView }) {
  if (!target.error) {
    return (
      <span className="text-xs text-[--muted]">{target.status ?? '—'}</span>
    );
  }
  return (
    <Popover
      className="w-96"
      align="start"
      trigger={
        <button
          type="button"
          className="inline-flex items-center gap-1 text-xs text-red-500 hover:underline underline-offset-2"
        >
          Push failed
          <BiInfoCircle className="h-3.5 w-3.5" />
        </button>
      }
    >
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-sm font-medium">Last push failed</div>
            <div className="text-xs text-[--muted]">
              {formatUnix(target.lastChecked)}
            </div>
          </div>
          <IconButton
            size="xs"
            intent="gray-subtle"
            icon={<BiCopy />}
            aria-label="Copy the error"
            onClick={() => copyText(target.error!)}
          />
        </div>
        <p className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-xs text-[--muted]">
          {target.error}
        </p>
      </div>
    </Popover>
  );
}

function FilesCell({
  title,
  description,
  files,
}: {
  title: string;
  description: string;
  files: PublishFile[];
}) {
  const [open, setOpen] = React.useState(false);
  const sorted = React.useMemo(() => sortFiles(files), [files]);
  const primary = sorted[0];

  if (!primary) return <span className="text-xs text-[--muted]">—</span>;

  const rest = sorted.length - 1;
  return (
    <div className="space-y-1">
      {primary.url ? (
        <button
          type="button"
          className="group flex items-center gap-1.5 text-xs font-mono max-w-[260px]"
          title={primary.url}
          aria-label={`Copy the URL for ${primary.label}`}
          onClick={() => copyText(primary.url!)}
        >
          <BiCopy className="h-3.5 w-3.5 shrink-0 text-[--muted] group-hover:text-[--brand]" />
          <span className="truncate group-hover:text-[--brand]">
            {primary.label}
          </span>
        </button>
      ) : (
        <span
          className="flex items-center gap-1.5 text-xs font-mono text-[--muted] max-w-[260px]"
          title="The URL appears once the file has been pushed"
        >
          <span className="truncate">{primary.label}</span>
        </span>
      )}
      {rest > 0 && (
        <button
          type="button"
          className="ml-5 text-xs text-[--muted] hover:text-[--foreground] hover:underline underline-offset-2"
          onClick={() => setOpen(true)}
        >
          {rest} more {rest === 1 ? 'file' : 'files'}
        </button>
      )}
      {open && (
        <FilesModal
          title={title}
          description={description}
          files={sorted}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

function FilesModal({
  title,
  description,
  files,
  onClose,
}: {
  title: string;
  description: string;
  files: PublishFile[];
  onClose: () => void;
}) {
  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title={title}
      description={description}
    >
      <div className="space-y-2 min-w-0">
        {files.map((file) => (
          <div
            key={file.key}
            className="rounded-[--radius] border border-[--border]/60 bg-[--subtle]/30 p-3 space-y-1.5"
          >
            <div className="text-sm font-mono break-all">{file.label}</div>
            <div className="text-xs text-[--muted]">{describeFile(file)}</div>
            {file.url ? (
              <div className="flex items-start gap-1">
                <span
                  className="flex-1 min-w-0 break-all text-xs font-mono text-[--muted]"
                  title={file.url}
                >
                  {file.url}
                </span>
                <IconButton
                  size="xs"
                  intent="gray-subtle"
                  icon={<BiCopy />}
                  aria-label={`Copy the URL for ${file.label}`}
                  onClick={() => copyText(file.url!)}
                />
              </div>
            ) : (
              <div className="text-xs text-[--muted]">
                The URL appears once the file has been pushed.
              </div>
            )}
          </div>
        ))}
      </div>
    </Modal>
  );
}

function PublishingView({
  snapshot,
  invalidate,
}: {
  snapshot: Snapshot;
  invalidate: () => void;
}) {
  const [editorOpen, setEditorOpen] = React.useState(false);
  const [exportOpen, setExportOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<PublishTargetView>();
  const [pendingDelete, setPendingDelete] = React.useState<PublishTargetView>();

  const patchTarget = useMutation({
    mutationFn: (args: { id: string; body: Record<string, unknown> }) =>
      api(`PATCH /dashboard/blocklist/targets/${args.id}`, {
        body: args.body,
      }),
    onSuccess: invalidate,
    onError: (e: any) => toast.error(e?.message ?? 'Update failed'),
  });

  const publishTarget = useMutation({
    mutationFn: (id: string) =>
      api<Snapshot>(`POST /dashboard/blocklist/targets/${id}/publish`, {
        body: {},
      }),
    // The push itself reports failure in the target's status, not as an HTTP
    // error, so read the outcome back out of the snapshot it returns.
    onSuccess: (pushed, id) => {
      const target = pushed.targets.find((t) => t.id === id);
      if (target?.error) {
        toast.error(target.error);
      } else {
        toast.success(target?.status ?? 'Pushed');
      }
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? 'Push failed'),
  });

  const deleteTarget = useMutation({
    mutationFn: (id: string) =>
      api(`DELETE /dashboard/blocklist/targets/${id}`),
    onSuccess: () => {
      toast.success('Target removed');
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? 'Delete failed'),
  });

  const confirmDelete = useConfirmationDialog({
    title: 'Remove publish target',
    description:
      'This stops pushing to this destination. Files already uploaded there are not deleted.',
    actionText: 'Remove',
    actionIntent: 'alert-subtle',
    onConfirm: () => pendingDelete && deleteTarget.mutate(pendingDelete.id),
  });

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap items-center">
        <Button
          size="sm"
          intent="primary-subtle"
          leftIcon={<BiPlus />}
          onClick={() => {
            setEditing(undefined);
            setEditorOpen(true);
          }}
        >
          Add target
        </Button>
        <p className="text-xs text-[--muted]">
          Push this instance&apos;s blocklist to remote destinations so others
          can subscribe without reaching your instance.
        </p>
      </div>

      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-[--muted] text-xs uppercase bg-[--subtle]/40">
              <tr className="text-left">
                <th className="p-3">Name</th>
                <th className="p-3">Provider</th>
                <th className="p-3">Files</th>
                <th className="p-3">Interval</th>
                <th className="p-3">Last push</th>
                <th className="p-3">Status</th>
                <th className="p-3">Enabled</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              <PublicExportRow
                snapshot={snapshot}
                invalidate={invalidate}
                onEdit={() => setExportOpen(true)}
              />
              {snapshot.targets.map((target) => (
                <tr
                  key={target.id}
                  className="border-t border-[--border]/50 hover:bg-[--subtle]/30"
                >
                  <td className="p-3 font-medium">
                    {target.name}
                    {target.configUnreadable && (
                      <div className="text-xs text-red-500">
                        config unreadable — re-enter it
                      </div>
                    )}
                  </td>
                  <td className="p-3">
                    <Badge className={PROVIDER_BADGE}>
                      {target.providerLabel}
                    </Badge>
                    <div className="text-xs text-[--muted] mt-1">
                      {summaryText(target)}
                    </div>
                  </td>
                  <td className="p-3">
                    <FilesCell
                      title={`Files pushed to "${target.name}"`}
                      description="Hand these URLs to anyone who wants to subscribe to this list."
                      files={targetFiles(target)}
                    />
                  </td>
                  <td className="p-3 tabular-nums">
                    {formatInterval(target.intervalSeconds)}
                  </td>
                  <td className="p-3 text-xs text-[--muted] whitespace-nowrap">
                    {formatUnix(target.lastPushed)}
                  </td>
                  <td className="p-3">
                    <StatusCell target={target} />
                  </td>
                  <td className="p-3">
                    <Switch
                      value={target.enabled}
                      onValueChange={(enabled) =>
                        patchTarget.mutate({
                          id: target.id,
                          body: { enabled },
                        })
                      }
                    />
                  </td>
                  <td className="p-3">
                    <div className="flex justify-end gap-1">
                      <IconButton
                        size="sm"
                        intent="gray-subtle"
                        icon={<BiUpload />}
                        aria-label="Push now"
                        loading={
                          publishTarget.isPending &&
                          publishTarget.variables === target.id
                        }
                        onClick={() => publishTarget.mutate(target.id)}
                      />
                      <IconButton
                        size="sm"
                        intent="gray-subtle"
                        icon={<BiPencil />}
                        aria-label="Edit target"
                        onClick={() => {
                          setEditing(target);
                          setEditorOpen(true);
                        }}
                      />
                      <IconButton
                        size="sm"
                        intent="alert-subtle"
                        icon={<BiTrash />}
                        aria-label="Remove target"
                        onClick={() => {
                          setPendingDelete(target);
                          confirmDelete.open();
                        }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {editorOpen && (
        <TargetEditorModal
          providers={snapshot.providers}
          target={editing}
          onClose={() => setEditorOpen(false)}
          invalidate={invalidate}
        />
      )}
      {exportOpen && (
        <PublicExportModal
          snapshot={snapshot}
          onClose={() => setExportOpen(false)}
          invalidate={invalidate}
        />
      )}
      <ConfirmationDialog {...confirmDelete} />
    </div>
  );
}

function summaryText(target: PublishTargetView): string {
  const s = target.summary;
  if (!s) return '';
  if (target.provider === 'github-gist') {
    return s.gistId ? `gist ${s.gistId}` : 'creates a gist on first push';
  }
  return '';
}

type PublicExportPatch = Partial<{
  publicExport: boolean;
  publicExportScope: PublishScope;
  publicExportPassword: string;
}>;

/** An env-set field is pinned outside the dashboard, so say so where it's shown. */
function envHelp(envVar: string | null): string | undefined {
  return envVar ? `Set by ${envVar}; change it in the environment.` : undefined;
}

/**
 * The pull-based public export shown as a pinned pseudo-target: the same
 * "where is my list available" mental model, but served live from
 * /blocklist/export instead of being pushed anywhere.
 */
function PublicExportRow({
  snapshot,
  invalidate,
  onEdit,
}: {
  snapshot: Snapshot;
  invalidate: () => void;
  onEdit: () => void;
}) {
  const { status } = useStatus();
  const baseUrl = status?.settings?.baseUrl || window.location.origin;
  const { settings, publicExportEnv: env } = snapshot;

  const toggle = useMutation({
    mutationFn: (publicExport: boolean) =>
      api('PATCH /dashboard/blocklist/settings', { body: { publicExport } }),
    onSuccess: invalidate,
    onError: (e: any) => toast.error(e?.message ?? 'Update failed'),
  });

  return (
    <tr className="border-t border-[--border]/50 bg-[--subtle]/20">
      <td className="p-3 font-medium">This instance</td>
      <td className="p-3">
        <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20">
          public export
        </Badge>
        <div className="text-xs text-[--muted] mt-1">
          served live, nothing is pushed
        </div>
      </td>
      <td className="p-3">
        {settings.publicExport ? (
          <FilesCell
            title="Files served by this instance"
            description="Hand these URLs to anyone who wants to subscribe to this list."
            files={publicExportFiles(settings, baseUrl)}
          />
        ) : (
          <span className="text-xs text-[--muted]">—</span>
        )}
      </td>
      <td className="p-3 tabular-nums">—</td>
      <td className="p-3 text-xs text-[--muted]">—</td>
      <td className="p-3 text-xs text-[--muted]">
        {settings.publicExport ? 'subscribers fetch it directly' : 'disabled'}
      </td>
      <td className="p-3">
        <span title={envHelp(env.publicExport)}>
          <Switch
            value={settings.publicExport}
            disabled={!!env.publicExport || toggle.isPending}
            onValueChange={(enabled) => toggle.mutate(enabled)}
          />
        </span>
      </td>
      <td className="p-3">
        <div className="flex justify-end gap-1">
          <IconButton
            size="sm"
            intent="gray-subtle"
            icon={<BiPencil />}
            aria-label="Edit the public export"
            onClick={onEdit}
          />
        </div>
      </td>
    </tr>
  );
}

/** Editor for the three public export settings, which are hidden from the
 *  generic settings page and only written through this page. */
function PublicExportModal({
  snapshot,
  onClose,
  invalidate,
}: {
  snapshot: Snapshot;
  onClose: () => void;
  invalidate: () => void;
}) {
  const { settings, publicExportEnv: env } = snapshot;
  const [enabled, setEnabled] = React.useState(settings.publicExport);
  const [scope, setScope] = React.useState<PublishScope>(
    settings.publicExportScope
  );
  const [password, setPassword] = React.useState(settings.publicExportPassword);

  const save = useMutation({
    mutationFn: (patch: PublicExportPatch) =>
      api('PATCH /dashboard/blocklist/settings', { body: patch }),
    onSuccess: () => {
      toast.success('Public export updated');
      onClose();
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? 'Save failed'),
  });

  // Only changed, non-env-locked fields are sent: the server refuses env-locked
  // keys, so submitting them unchanged would fail the whole save.
  const trySave = () => {
    const patch: PublicExportPatch = {};
    if (!env.publicExport && enabled !== settings.publicExport) {
      patch.publicExport = enabled;
    }
    if (!env.publicExportScope && scope !== settings.publicExportScope) {
      patch.publicExportScope = scope;
    }
    if (
      !env.publicExportPassword &&
      password !== settings.publicExportPassword
    ) {
      patch.publicExportPassword = password;
    }
    if (Object.keys(patch).length === 0) return onClose();
    save.mutate(patch);
  };

  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title="Public export"
      description="Serve this instance's blocklist at /blocklist/export so others can subscribe to it directly."
    >
      <div className="space-y-3">
        <Switch
          side="right"
          label="Serve the public export"
          value={enabled}
          disabled={!!env.publicExport}
          onValueChange={setEnabled}
          help={
            envHelp(env.publicExport) ??
            'The list contains only release digests and backbone root domains.'
          }
        />
        <Select
          label="Scope"
          options={[
            { label: 'local (own verdicts)', value: 'local' },
            { label: 'all (every source)', value: 'all' },
          ]}
          value={scope}
          disabled={!!env.publicExportScope}
          onValueChange={(v) => setScope(v as PublishScope)}
          help={
            envHelp(env.publicExportScope) ??
            'The most a subscriber may ask for. With local, only verdicts this instance recorded first-hand are ever served.'
          }
        />
        <TextInput
          type="password"
          label="Password"
          placeholder="No password"
          value={password}
          disabled={!!env.publicExportPassword}
          onValueChange={setPassword}
          help={
            envHelp(env.publicExportPassword) ??
            'When set, subscribers must pass ?key=<value>. A missing or wrong key gets the same 404 as a disabled export, so the endpoint stays invisible.'
          }
        />
        {scope === 'all' && (
          <Alert intent="warning">
            Serving the &quot;all&quot; scope rebroadcasts lists you subscribe
            to: one upstream verdict can then look independently corroborated to
            anyone consuming both lists. Prefer &quot;local&quot; unless you are
            deliberately aggregating.
          </Alert>
        )}
        <div className="flex justify-end gap-2">
          <Button intent="gray-outline" onClick={onClose}>
            Cancel
          </Button>
          <Button intent="primary" loading={save.isPending} onClick={trySave}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}

type FieldValues = Record<string, string | boolean>;

/** Initial form values: summaries prefill non-secret fields when editing. */
function initFieldValues(
  fields: PublishProviderField[],
  summary: Record<string, any>,
  editing: boolean
): FieldValues {
  const values: FieldValues = {};
  for (const field of fields) {
    if (field.type === 'switch') {
      const fromSummary = editing ? summary[field.key] : undefined;
      values[field.key] = !!(fromSummary ?? field.default ?? false);
    } else if (field.secret) {
      values[field.key] = '';
    } else {
      const fromSummary = editing ? summary[field.key] : undefined;
      values[field.key] =
        fromSummary != null ? String(fromSummary) : String(field.default ?? '');
    }
  }
  return values;
}

function FieldInput({
  field,
  value,
  editing,
  onChange,
}: {
  field: PublishProviderField;
  value: string | boolean;
  editing: boolean;
  onChange: (value: string | boolean) => void;
}) {
  const help = (editing && field.editHelp) || field.help;
  const placeholder = (editing && field.editPlaceholder) || field.placeholder;
  if (field.type === 'switch') {
    return (
      <Switch
        side="right"
        label={field.label}
        value={!!value}
        onValueChange={onChange}
        help={help}
      />
    );
  }
  if (field.type === 'select') {
    return (
      <Select
        label={field.label}
        options={field.options ?? []}
        value={String(value)}
        onValueChange={onChange}
        help={help}
      />
    );
  }
  if (field.type === 'textarea') {
    return (
      <Textarea
        label={field.label}
        rows={3}
        placeholder={placeholder}
        value={String(value)}
        onValueChange={onChange}
        help={help}
      />
    );
  }
  return (
    <TextInput
      type={field.type === 'password' ? 'password' : 'text'}
      label={field.label}
      placeholder={placeholder}
      value={String(value)}
      onValueChange={onChange}
      help={help}
    />
  );
}

function TargetEditorModal({
  providers,
  target,
  onClose,
  invalidate,
}: {
  providers: PublishProviderInfo[];
  target?: PublishTargetView;
  onClose: () => void;
  invalidate: () => void;
}) {
  const editing = !!target;
  const summary = (target?.summary ?? {}) as Record<string, any>;
  const [providerId, setProviderId] = React.useState(
    target?.provider ?? providers[0]?.id ?? 'github-gist'
  );
  const provider = providers.find((p) => p.id === providerId);

  const [name, setName] = React.useState(target?.name ?? '');
  const [intervalHours, setIntervalHours] = React.useState(
    target ? Math.max(1, Math.round(target.intervalSeconds / 3600)) : 6
  );
  const [artifacts, setArtifacts] = React.useState<ArtifactDraft[]>(
    target
      ? target.artifacts.map((a) => ({
          format: a.format,
          scope: a.scope,
          gzip: a.gzip,
        }))
      : [
          {
            format: 'native',
            scope: 'local',
            gzip: !!provider?.capabilities.binary,
          },
        ]
  );
  const [values, setValues] = React.useState<FieldValues>(() =>
    initFieldValues(provider?.fields ?? [], summary, editing)
  );

  const changeProvider = (id: string) => {
    const next = providers.find((p) => p.id === id);
    setProviderId(id);
    setValues(initFieldValues(next?.fields ?? [], {}, false));
    setArtifacts((list) =>
      list.map((a) => ({
        ...a,
        gzip: !!next?.capabilities.binary && a.gzip,
      }))
    );
  };

  const buildConfig = (): Record<string, unknown> => {
    const config: Record<string, unknown> = {};
    for (const field of provider?.fields ?? []) {
      const value = values[field.key];
      if (field.type === 'switch') {
        config[field.key] = !!value;
        continue;
      }
      const text = String(value ?? '').trim();
      if (field.secret) {
        // Blank secrets are omitted: the server keeps the stored value.
        if (text) config[field.key] = text;
      } else {
        // Non-secret fields always submit; a cleared input is intentional.
        config[field.key] = text;
      }
    }
    return config;
  };

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        name: name.trim(),
        intervalSeconds: Math.round(intervalHours * 3600),
        artifacts: artifacts.map((a) => ({
          format: a.format,
          scope: a.scope,
          gzip: provider?.capabilities.binary ? a.gzip : false,
        })),
        config: buildConfig(),
      };
      if (editing) {
        return api(`PATCH /dashboard/blocklist/targets/${target.id}`, {
          body,
        });
      }
      return api('POST /dashboard/blocklist/targets', {
        body: { ...body, provider: providerId },
      });
    },
    onSuccess: () => {
      toast.success(editing ? 'Target updated' : 'Target added');
      onClose();
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? 'Save failed'),
  });

  const trySave = () => {
    if (!name.trim()) return toast.error('a name is required');
    const keys = new Set(artifacts.map((a) => `${a.format}:${a.scope}`));
    if (keys.size !== artifacts.length) {
      return toast.error('duplicate format/scope file');
    }
    for (const field of provider?.fields ?? []) {
      const value = values[field.key];
      if (
        field.required &&
        field.type !== 'switch' &&
        !String(value ?? '').trim() &&
        !(editing && field.secret)
      ) {
        return toast.error(`${field.label} is required`);
      }
    }
    save.mutate();
  };

  const hasAllScope = artifacts.some((a) => a.scope === 'all');

  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title={editing ? `Edit "${target.name}"` : 'Add publish target'}
    >
      <div className="space-y-3">
        {!editing && (
          <Select
            label="Provider"
            options={providers.map((p) => ({ label: p.label, value: p.id }))}
            value={providerId}
            onValueChange={changeProvider}
          />
        )}
        <TextInput label="Name" value={name} onValueChange={setName} />
        <NumberInput
          label="Push interval (hours)"
          value={intervalHours}
          min={1}
          max={720}
          onValueChange={(v) => setIntervalHours(v || 6)}
        />

        {(provider?.fields ?? []).map((field) => (
          <FieldInput
            key={`${providerId}:${field.key}`}
            field={field}
            value={values[field.key] ?? (field.type === 'switch' ? false : '')}
            editing={editing}
            onChange={(value) =>
              setValues((prev) => ({ ...prev, [field.key]: value }))
            }
          />
        ))}

        <div className="space-y-2">
          <label className="text-xs font-medium text-[--muted] ml-1">
            Files to push
          </label>
          {artifacts.map((artifact, index) => (
            <div
              key={index}
              className="rounded-[--radius] border border-[--border]/60 bg-[--subtle]/30 p-3 space-y-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono text-[--muted]">
                  {`blocklist-${artifact.scope}${artifact.format === 'warden' ? '-warden' : ''}.ndjson${artifact.gzip ? '.gz' : ''}`}
                </span>
                {artifacts.length > 1 && (
                  <IconButton
                    size="xs"
                    rounded
                    intent="alert-subtle"
                    icon={<BiTrash />}
                    aria-label="Remove file"
                    onClick={() =>
                      setArtifacts((list) => list.filter((_, i) => i !== index))
                    }
                  />
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Select
                  label="Format"
                  options={[
                    { label: 'native', value: 'native' },
                    { label: 'warden', value: 'warden' },
                  ]}
                  value={artifact.format}
                  onValueChange={(v) =>
                    setArtifacts((list) =>
                      list.map((a, i) =>
                        i === index ? { ...a, format: v as PublishFormat } : a
                      )
                    )
                  }
                />
                <Select
                  label="Scope"
                  options={[
                    { label: 'local (own verdicts)', value: 'local' },
                    { label: 'all (every source)', value: 'all' },
                  ]}
                  value={artifact.scope}
                  onValueChange={(v) =>
                    setArtifacts((list) =>
                      list.map((a, i) =>
                        i === index ? { ...a, scope: v as PublishScope } : a
                      )
                    )
                  }
                />
              </div>
              {provider?.capabilities.binary && (
                <Switch
                  side="right"
                  label="Compress (gzip)"
                  value={artifact.gzip}
                  onValueChange={(gzip) =>
                    setArtifacts((list) =>
                      list.map((a, i) => (i === index ? { ...a, gzip } : a))
                    )
                  }
                />
              )}
            </div>
          ))}
          {artifacts.length < 4 && (
            <div className="flex justify-center">
              <IconButton
                size="sm"
                rounded
                intent="primary-subtle"
                icon={<BiPlus />}
                aria-label="Add file"
                onClick={() =>
                  setArtifacts((list) => [
                    ...list,
                    {
                      format: 'warden',
                      scope: 'local',
                      gzip: !!provider?.capabilities.binary,
                    },
                  ])
                }
              />
            </div>
          )}
          {hasAllScope && (
            <Alert intent="warning">
              Publishing the &quot;all&quot; scope rebroadcasts lists you
              subscribe to: one upstream verdict can then look independently
              corroborated to anyone consuming both lists. Prefer
              &quot;local&quot; unless you are deliberately aggregating.
            </Alert>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button intent="gray-outline" onClick={onClose}>
            Cancel
          </Button>
          <Button intent="primary" loading={save.isPending} onClick={trySave}>
            {editing ? 'Save' : 'Add target'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
