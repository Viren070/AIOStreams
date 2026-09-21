import React from 'react';
import { toast } from 'sonner';
import { LuCheck, LuRefreshCw } from 'react-icons/lu';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Alert } from '@/components/ui/alert';
import { Select } from '@/components/ui/select';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  linkedAccountPlatformsQuery,
  LINKED_ACCOUNTS_QUERY_ROOT,
} from '@/lib/queries';
import { linkAccount, pushLinkedAccount, type Credentials } from '@/lib/api';
import {
  PlatformCredentialFields,
  initialCredentialState,
  platformCredentialsComplete,
  platformLinkInput,
  type PlatformCredentialState,
} from '@/components/shared/linked-accounts/platform-credential-fields';

export const LINK_OFFER_DISMISSED_KEY =
  'aiostreams:linked-accounts:offer-dismissed';

export function linkOfferDismissed(): boolean {
  if (typeof window === 'undefined') return true;
  return localStorage.getItem(LINK_OFFER_DISMISSED_KEY) === 'true';
}

interface LinkOfferModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  credentials: Credentials;
  manifestUrl: string;
}

/**
 * Offered once, right after a configuration is created, because that is when
 * someone has a manifest URL and no idea what to do with it. Only platforms
 * that are apps you install into are offered here.
 */
export function LinkOfferModal({
  open,
  onOpenChange,
  credentials,
  manifestUrl,
}: LinkOfferModalProps) {
  const queryClient = useQueryClient();
  const { data: platforms = [] } = useQuery(
    linkedAccountPlatformsQuery(credentials)
  );
  const clients = platforms.filter((entry) => entry.kind === 'client');

  const [platformId, setPlatformId] = React.useState<string | null>(null);
  const platform =
    clients.find((entry) => entry.id === platformId) ?? clients[0] ?? null;

  const [state, setState] = React.useState<PlatformCredentialState | null>(
    null
  );
  const [linking, setLinking] = React.useState(false);
  const [linked, setLinked] = React.useState<string | null>(null);

  React.useEffect(() => {
    setState(platform ? initialCredentialState(platform) : null);
  }, [platform?.id]);

  const dismiss = (permanently: boolean) => {
    if (permanently) localStorage.setItem(LINK_OFFER_DISMISSED_KEY, 'true');
    onOpenChange(false);
  };

  const handleLink = async () => {
    if (!platform || !state) return;
    setLinking(true);
    try {
      const account = await linkAccount(credentials, {
        platform: platform.id,
        input: platformLinkInput(platform, state),
        manifestUrls: [manifestUrl],
      });
      await pushLinkedAccount(credentials, account.id);
      await queryClient.invalidateQueries({
        queryKey: LINKED_ACCOUNTS_QUERY_ROOT,
      });
      setLinked(account.identity ?? platform.name);
      toast.success(
        `AIOStreams installed to ${account.identity ?? platform.name}`
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : `Could not link your ${platform.name} account`
      );
    } finally {
      setLinking(false);
    }
  };

  if (!platform) return null;

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) dismiss(false);
      }}
      title={linked ? 'All set' : `Install to ${platform.name}?`}
      description={linked ? undefined : platform.description}
      contentClass="max-w-lg"
    >
      {linked ? (
        <div className="min-w-0 space-y-4">
          <Alert
            intent="success"
            title={`AIOStreams is installed to ${linked}.`}
            description="
                Whenever you change your configuration you will be offered the
                chance to push the update, so you never have to reinstall by
                hand.
              
            "
          />
          <Button
            intent="primary"
            className="w-full"
            onClick={() => dismiss(false)}
          >
            Done
          </Button>
        </div>
      ) : (
        <div className="min-w-0 space-y-4">
          <div className="flex items-center gap-3 rounded-lg border border-gray-700 bg-gray-800/40 p-3">
            {platform.logo && (
              <img
                src={platform.logo}
                alt={platform.name}
                className="h-8 w-8 shrink-0 object-contain"
              />
            )}
            <p className="text-xs text-gray-400">
              This is optional. You can close it and install from the links on
              this page instead.
            </p>
          </div>

          {clients.length > 1 && (
            <Select
              label="Install to"
              value={platform.id}
              onValueChange={setPlatformId}
              options={clients.map((entry) => ({
                value: entry.id,
                label: entry.name,
              }))}
            />
          )}

          {state && (
            <PlatformCredentialFields
              platform={platform}
              value={state}
              onChange={setState}
            />
          )}

          <Alert
            intent="info-basic"
            description={
              <div>
                Installing somewhere else, want to install manually or not sure
                yet? Skip this. Your install links are on this page whenever you
                need them.
              </div>
            }
          />

          <div className="flex flex-col gap-2">
            <Button
              intent="primary"
              className="w-full"
              disabled={!state || !platformCredentialsComplete(platform, state)}
              loading={linking}
              onClick={handleLink}
              leftIcon={<LuRefreshCw className="h-4 w-4" />}
            >
              Install to {platform.name}
            </Button>
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => dismiss(false)}
                className="text-xs text-gray-400 hover:text-white"
              >
                Not now
              </button>
              <button
                type="button"
                onClick={() => dismiss(true)}
                className="text-xs text-gray-500 hover:text-white"
              >
                Don&apos;t show this again
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
