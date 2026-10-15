import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { BiCopy, BiLinkExternal } from 'react-icons/bi';
import { Button } from '@aiostreams/ui/button';
import { Card } from '@aiostreams/ui/card';
import { LoadingOverlay } from '@aiostreams/ui/loading-spinner';
import { LuffyError } from '@aiostreams/ui/shared/luffy-error';
import { copyToClipboard } from '@aiostreams/ui/utils/clipboard';
import type { PartyRelayInfo } from '@aiostreams/core';

/*
 * Where an invite link lands. The code stays in the address's fragment, which
 * browsers never send, so the relay never sees it.
 */

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function inviteCode(): string | null {
  const code = window.location.hash.slice(1).toUpperCase().replace(/-/g, '');
  return code.length === 10 && [...code].every((c) => ALPHABET.includes(c))
    ? code
    : null;
}

/** The relay is this page's server, which may sit under a path. */
const relay = () =>
  window.location.origin +
  window.location.pathname.replace(/\/party\/join\/?$/, '');

export function PartyInvitePage() {
  const code = inviteCode();
  const base = relay();
  const info = useQuery({
    queryKey: ['party-relay', base],
    queryFn: async () =>
      (await (await fetch(`${base}/party/v1`)).json()) as PartyRelayInfo,
    enabled: !!code,
    retry: false,
  });

  if (!code)
    return (
      <LoadingOverlay showSpinner={false}>
        <LuffyError title="This invite is incomplete" showRefreshButton={false}>
          <p>Part of the link is missing. Ask for the invite again.</p>
        </LuffyError>
      </LoadingOverlay>
    );

  const appLink = `aiostreams://party?relay=${encodeURIComponent(base)}&code=${code}`;
  const usersOnly = info.data?.relay === 'off';
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md space-y-6 p-6 text-center">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            You're invited to watch together
          </h1>
          <p className="text-sm text-[--muted]">
            Open the invite in the app, or join from its Watch together menu
            with this code.
          </p>
        </div>
        <div className="rounded-xl bg-[--subtle] p-4">
          <p className="font-mono text-3xl font-semibold tracking-wider">
            {code.slice(0, 5)}-{code.slice(5)}
          </p>
          <p className="mt-1 break-all text-xs text-[--muted]">on {base}</p>
        </div>
        {usersOnly && (
          <p className="rounded-xl bg-[--subtle] p-3 text-sm text-[--muted]">
            Only people with an account on this server can join its parties.
          </p>
        )}
        {info.isError && (
          <p className="rounded-xl bg-[--subtle] p-3 text-sm text-[--muted]">
            This server doesn't answer as a party relay right now, so the party
            may have ended.
          </p>
        )}
        <div className="space-y-2">
          <Button
            intent="white"
            rounded
            className="w-full"
            leftIcon={<BiLinkExternal />}
            onClick={() => {
              window.location.href = appLink;
            }}
          >
            Open in the app
          </Button>
          <Button
            intent="gray-outline"
            rounded
            className="w-full"
            leftIcon={<BiCopy />}
            onClick={() =>
              copyToClipboard(window.location.href, {
                onSuccess: () => toast.success('Invite copied'),
                onError: () => toast.error('Could not copy the invite'),
              })
            }
          >
            Copy the invite
          </Button>
        </div>
      </Card>
    </main>
  );
}
