import React from 'react';
import { toast } from 'sonner';
import { LuLink2, LuRefreshCw, LuSettings } from 'react-icons/lu';
import { Button, IconButton } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { TextInput } from '@/components/ui/text-input';
import { Alert } from '@/components/ui/alert';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import {
  ConfirmationDialog,
  useConfirmationDialog,
} from '@/components/shared/confirmation-dialog';
import { useDisclosure } from '@/hooks/disclosure';
import { useUserData } from '@/context/userData';
import {
  PushTargetsField,
  pushTargetsToUrls,
  type PushTarget,
} from '@/components/shared/linked-accounts/push-targets-field';
import type { VariantOption } from '@/components/shared/variant-pills';
import { parseVariantIds } from '@/lib/manifest-url';
import { useStatus } from '@/context/status';
import {
  PlatformCredentialFields,
  initialCredentialState,
  platformCredentialsComplete,
  platformLinkInput,
  type PlatformCredentialState,
} from '@/components/shared/linked-accounts/platform-credential-fields';
import { useSave } from '@/context/save';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  linkedAccountsQuery,
  linkedAccountPlatformsQuery,
  LINKED_ACCOUNTS_QUERY_ROOT,
} from '@/lib/queries';
import {
  linkAccount,
  probeLinkedAccount,
  pushLinkedAccount,
  unlinkAccount,
  updateLinkedAccount,
  type LinkedAccount,
  type LinkedAccountPlatformInfo,
  type Credentials,
} from '@/lib/api';

function relativeTime(timestamp?: number): string {
  if (!timestamp) return 'never';
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function platformSummary(platforms: LinkedAccountPlatformInfo[]): string {
  return `to one of the supported platforms (e.g. ${platforms
    .slice(0, 3)
    .map((entry) => entry.name)
    .join(', ')})`;
}

/**
 * Only comparable when the account tracks exactly the URL the configure page
 * fingerprinted; against any other set we cannot tell, so we do not guess.
 */
function isStale(
  account: LinkedAccount,
  currentUrl: string | null,
  currentFingerprint: string | null
): boolean {
  const urls = account.config?.manifestUrls ?? [];
  if (!currentUrl || !currentFingerprint || !account.lastPushedManifestHash) {
    return false;
  }
  if (urls.length !== 1 || urls[0] !== currentUrl) return false;
  return account.lastPushedManifestHash !== currentFingerprint;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

interface LinkedAccountsSectionProps {
  /** The manifest URL currently shown in the install card. */
  manifestUrl: string;
}

export function LinkedAccountsSection({
  manifestUrl,
}: LinkedAccountsSectionProps) {
  const { uuid, password, encryptedPassword, userData } = useUserData();
  const { currentManifestFingerprint, currentManifestUrl } = useSave();
  const { status } = useStatus();
  const urlParts = {
    baseUrl:
      status?.settings?.baseUrl ||
      (typeof window !== 'undefined' ? window.location.origin : ''),
    uuid: uuid ?? '',
    encryptedPassword: encryptedPassword ?? undefined,
  };
  const variants = userData.variants ?? [];
  const credentials = uuid ? { uuid, password } : null;

  const queryClient = useQueryClient();
  const { data: accounts, isPending } = useQuery(
    linkedAccountsQuery(credentials)
  );
  const { data: platforms = [] } = useQuery(
    linkedAccountPlatformsQuery(credentials)
  );
  const platformOf = (id: string) =>
    platforms.find((entry) => entry.id === id) ?? null;
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [managing, setManaging] = React.useState<LinkedAccount | null>(null);
  const linkModal = useDisclosure(false);

  const reload = () =>
    queryClient.invalidateQueries({ queryKey: LINKED_ACCOUNTS_QUERY_ROOT });

  if (!credentials) return null;

  const handlePush = async (account: LinkedAccount) => {
    setBusyId(account.id);
    try {
      await pushLinkedAccount(credentials, account.id);
      toast.success(`Pushed to ${account.label}`);
    } catch (error) {
      toast.error(errorMessage(error, `Could not push to ${account.label}`));
    } finally {
      setBusyId(null);
      void reload();
    }
  };

  const hasAccounts = (accounts?.length ?? 0) > 0;

  return (
    <div id="linked-accounts">
      <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-4 flex items-center gap-2">
        <div className="h-px bg-gray-700 flex-1"></div>
        Linked accounts
        <div className="h-px bg-gray-700 flex-1"></div>
      </h3>

      {isPending ? (
        <div className="flex justify-center py-4">
          <LoadingSpinner />
        </div>
      ) : hasAccounts ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {(accounts ?? []).map((account) => (
            <LinkedAccountCard
              key={account.id}
              account={account}
              platform={platformOf(account.platform)}
              stale={isStale(
                account,
                currentManifestUrl,
                currentManifestFingerprint
              )}
              busy={busyId === account.id}
              onPush={() => handlePush(account)}
              onManage={() => setManaging(account)}
            />
          ))}
          <button
            type="button"
            onClick={linkModal.open}
            className="group flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-700 p-3 text-sm text-gray-400 transition-colors hover:border-brand-400 hover:text-brand-400"
          >
            <LuLink2 className="h-4 w-4" /> Link another account
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3 rounded-xl border border-gray-700/70 bg-gray-800/30 px-4 py-3 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <LuLink2 className="h-4 w-4 shrink-0 text-gray-500" />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-gray-300">
                Keep AIOStreams up to date automatically
              </p>
              <p className="text-xs text-gray-500">
                Optional. Link {platformSummary(platforms)} and AIOStreams can
                push config changes for you, instead of you reinstalling by
                hand.
              </p>
            </div>
          </div>
          <Button
            intent="gray-outline"
            className="w-full sm:w-auto"
            onClick={linkModal.open}
          >
            Link an account
          </Button>
        </div>
      )}

      <LinkAccountModal
        variants={variants}
        urlParts={urlParts}
        open={linkModal.isOpen}
        onOpenChange={(open) => (open ? linkModal.open() : linkModal.close())}
        credentials={credentials}
        manifestUrl={manifestUrl}
        onLinked={() => {
          linkModal.close();
          void reload();
        }}
      />

      <ManageAccountModal
        variants={variants}
        urlParts={urlParts}
        account={managing}
        platform={managing ? platformOf(managing.platform) : null}
        credentials={credentials}
        onClose={() => setManaging(null)}
        onChanged={() => {
          setManaging(null);
          void reload();
        }}
      />
    </div>
  );
}

interface LinkedAccountCardProps {
  account: LinkedAccount;
  platform: LinkedAccountPlatformInfo | null;
  /** The manifest has changed since the last successful push. */
  stale: boolean;
  busy: boolean;
  onPush: () => void;
  onManage: () => void;
}

function LinkedAccountCard({
  account,
  platform,
  stale,
  busy,
  onPush,
  onManage,
}: LinkedAccountCardProps) {
  const failed = account.lastStatus === 'error';
  const expired = account.lastStatus === 'expired';
  const pushed = account.lastStatus === 'ok';

  const [dotClass, status] = expired
    ? ['bg-red-300', 'Sign in again']
    : failed
      ? ['bg-red-300', account.lastError ?? 'Last push failed']
      : stale
        ? ['bg-amber-400', 'Changes not pushed']
        : pushed
          ? ['bg-emerald-400', `Pushed ${relativeTime(account.lastSyncedAt)}`]
          : ['bg-gray-600', 'Not pushed yet'];

  // Two per row from sm, so a card is narrowest just above that breakpoint,
  // not on a phone. The actions only sit inline once there is room at lg.
  return (
    <div className="flex flex-col gap-3 rounded-xl border-2 border-gray-700 bg-gradient-to-br from-gray-800/50 to-gray-800/30 p-3 lg:flex-row lg:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="flex-shrink-0 h-8 w-8 rounded-lg overflow-hidden flex items-center justify-center">
          {platform?.logo && (
            <img
              src={platform.logo}
              alt={platform.name}
              className="h-full w-full object-contain"
            />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium text-white">
              {account.label}
            </span>
            <span
              title={status}
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`}
            />
          </div>
          <p className="truncate text-xs text-gray-500">{status}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 lg:shrink-0">
        <Button
          intent="primary-subtle"
          size="sm"
          className="flex-1 lg:flex-none"
          loading={busy}
          onClick={onPush}
          leftIcon={<LuRefreshCw className="h-3.5 w-3.5" />}
        >
          Push
        </Button>
        <IconButton
          intent="gray-basic"
          size="sm"
          aria-label={`Manage ${account.label}`}
          icon={<LuSettings />}
          onClick={onManage}
        />
      </div>
    </div>
  );
}

interface UrlParts {
  baseUrl: string;
  uuid: string;
  encryptedPassword?: string;
}

interface LinkAccountModalProps {
  variants: VariantOption[];
  urlParts: UrlParts;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  credentials: Credentials;
  manifestUrl: string;
  onLinked: () => void;
}

function LinkAccountModal({
  variants,
  urlParts,
  open,
  onOpenChange,
  credentials,
  manifestUrl,
  onLinked,
}: LinkAccountModalProps) {
  const { data: platforms = [] } = useQuery(
    linkedAccountPlatformsQuery(credentials)
  );
  const [platformId, setPlatformId] = React.useState<string | null>(null);
  const platform =
    platforms.find((entry) => entry.id === platformId) ?? platforms[0] ?? null;

  const [state, setState] = React.useState<PlatformCredentialState | null>(
    null
  );
  const [targets, setTargets] = React.useState<PushTarget[]>([[]]);
  const [linking, setLinking] = React.useState(false);
  const [probe, setProbe] = React.useState<{
    state: 'idle' | 'checking' | 'ok' | 'bad';
    message?: string;
  }>({ state: 'idle' });

  React.useEffect(() => {
    setState(platform ? initialCredentialState(platform) : null);
    setProbe({ state: 'idle' });
  }, [platform?.id]);

  const probeValue = platform?.probeOn
    ? (state?.values[platform.probeOn] ?? '').trim().replace(/\/+$/, '')
    : '';

  React.useEffect(() => {
    if (!platform?.probeOn || !open || !probeValue) {
      setProbe({ state: 'idle' });
      return;
    }
    let cancelled = false;
    setProbe({ state: 'checking' });
    const timer = setTimeout(async () => {
      try {
        const result = await probeLinkedAccount(
          credentials,
          platform.id,
          probeValue
        );
        if (!cancelled) {
          setProbe({
            state: result.ok ? 'ok' : 'bad',
            message: result.ok
              ? `Reachable${result.version ? ` (${platform.name} ${result.version})` : ''}`
              : result.message,
          });
        }
      } catch (error) {
        if (!cancelled) {
          setProbe({
            state: 'bad',
            message: errorMessage(error, 'Could not reach that address.'),
          });
        }
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [platform?.id, platform?.probeOn, open, probeValue]);

  const handleLink = async () => {
    if (!platform || !state) return;
    const urls = variants.length
      ? pushTargetsToUrls(targets, urlParts)
      : [manifestUrl];
    setLinking(true);
    try {
      const account = await linkAccount(credentials, {
        platform: platform.id,
        input: platformLinkInput(platform, state),
        manifestUrls: urls,
      });
      toast.success(`Linked ${account.label}`);
      onLinked();
    } catch (error) {
      toast.error(errorMessage(error, 'Could not link that account'));
    } finally {
      setLinking(false);
    }
  };

  const canLink =
    !!platform &&
    !!state &&
    platformCredentialsComplete(platform, state) &&
    (!platform.probeOn || probe.state === 'ok');

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Link an account"
      description="AIOStreams will push this configuration's manifest URL to the account you link. Nothing else on that account is changed."
      contentClass="max-w-lg"
    >
      <div className="min-w-0 space-y-4">
        {platforms.length > 1 && (
          <Select
            label="Platform"
            value={platform?.id ?? ''}
            onValueChange={setPlatformId}
            options={platforms.map((entry) => ({
              value: entry.id,
              label: entry.name,
            }))}
          />
        )}

        {platform && state && (
          <>
            <p className="text-xs text-gray-400">{platform.description}</p>
            <PlatformCredentialFields
              platform={platform}
              value={state}
              onChange={setState}
            />
            {probe.state === 'checking' && (
              <p className="text-xs text-gray-500">Checking…</p>
            )}
            {probe.state === 'bad' && (
              <Alert intent="warning" description={probe.message} />
            )}
            {probe.state === 'ok' && (
              <p className="text-xs text-emerald-400">{probe.message}</p>
            )}
          </>
        )}

        {variants.length > 0 ? (
          <PushTargetsField
            variants={variants}
            value={targets}
            onChange={setTargets}
            {...urlParts}
          />
        ) : (
          <div className="min-w-0 rounded-lg bg-gray-900/40 p-3">
            <p className="text-xs text-gray-500">
              Will keep this URL up to date
            </p>
            <p className="break-all font-mono text-xs text-gray-400">
              {manifestUrl}
            </p>
          </div>
        )}

        <Button
          className="w-full"
          intent="primary"
          disabled={!canLink}
          loading={linking}
          onClick={handleLink}
        >
          Link account
        </Button>
      </div>
    </Modal>
  );
}

interface ManageAccountModalProps {
  variants: VariantOption[];
  urlParts: UrlParts;
  account: LinkedAccount | null;
  platform: LinkedAccountPlatformInfo | null;
  credentials: Credentials;
  onClose: () => void;
  onChanged: () => void;
}

function ManageAccountModal({
  variants,
  urlParts,
  account,
  platform,
  credentials,
  onClose,
  onChanged,
}: ManageAccountModalProps) {
  const [label, setLabel] = React.useState('');
  const [autoPush, setAutoPush] = React.useState(true);
  const [targets, setTargets] = React.useState<PushTarget[]>([[]]);
  const [saving, setSaving] = React.useState(false);
  const unlinkDialog = useConfirmationDialog({
    title: 'Unlink account',
    description: account?.config?.mintedSession
      ? 'AIOStreams will stop pushing updates and sign out the session it created, so the stored credential stops working. The addon stays installed there.'
      : 'AIOStreams will stop pushing updates and forget the credential you gave it. The addon stays installed there.',
    onConfirm: async () => {
      if (!account) return;
      try {
        await unlinkAccount(credentials, account.id);
        toast.success('Account unlinked');
        onChanged();
      } catch (error) {
        toast.error(errorMessage(error, 'Could not unlink that account'));
      }
    },
  });

  React.useEffect(() => {
    if (!account) return;
    setLabel(account.label);
    setAutoPush(account.autoPush);
    const urls = account.config?.manifestUrls ?? [];
    setTargets(urls.length ? urls.map(parseVariantIds) : [[]]);
  }, [account]);

  const handleSave = async () => {
    if (!account) return;
    setSaving(true);
    try {
      await updateLinkedAccount(credentials, account.id, {
        label,
        autoPush,
        ...(variants.length
          ? { manifestUrls: pushTargetsToUrls(targets, urlParts) }
          : {}),
      });
      toast.success('Saved');
      onChanged();
    } catch (error) {
      toast.error(errorMessage(error, 'Could not save those changes'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Modal
        open={account !== null}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        title={platform?.name ?? account?.label ?? ''}
        description={account?.identity ?? undefined}
        contentClass="max-w-md"
      >
        <div className="space-y-4">
          <TextInput label="Name" value={label} onValueChange={setLabel} />
          <PushTargetsField
            variants={variants}
            value={targets}
            onChange={setTargets}
            {...urlParts}
          />
          <div className="flex items-center justify-between rounded-lg bg-gray-800/50 p-3">
            <div className="flex-1 pr-3">
              <div className="text-sm font-medium text-white">
                Include in automatic pushes
              </div>
              <div className="mt-1 text-xs text-gray-400">
                Only applies when you have turned automatic pushing on.
              </div>
            </div>
            <Switch
              id="linked-account-auto-push"
              value={autoPush}
              onValueChange={setAutoPush}
            />
          </div>
          <div className="flex justify-between gap-3">
            <Button intent="alert-subtle" onClick={unlinkDialog.open}>
              Unlink
            </Button>
            <Button intent="primary" loading={saving} onClick={handleSave}>
              Save
            </Button>
          </div>
        </div>
      </Modal>
      <ConfirmationDialog {...unlinkDialog} />
    </>
  );
}
