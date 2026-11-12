import { t } from '@lingui/core/macro';
import { Drawer } from '@aiostreams/ui/drawer';
import { cn } from '@aiostreams/ui/core/styling';
import { useRestoreFocus } from '@/lib/input';
import type { Invite as PartyInvite } from '@/lib/party/invite';
import { useParty, type PartyState } from '@/lib/party/party';
import { closePartySheet, useSheet } from './sheet-state';
import { GUTTER } from './common';
import { JoinPreview, NotInParty } from './not-in-party';
import { InParty } from './in-party';

/** The watch party panel: starting or joining one, then the party itself. */
export function PartySheet() {
  const { open, opening } = useSheet();
  const state = useParty();
  const restoreFocus = useRestoreFocus(open);
  const invite =
    opening.invite && !isCurrent(opening.invite, state)
      ? opening.invite
      : undefined;
  return (
    <Drawer
      data-ui="dialog"
      data-name="party"
      open={open}
      onOpenChange={(next) => !next && closePartySheet()}
      onCloseAutoFocus={restoreFocus}
      title={
        invite ? t`Join a party` : state ? t`Watch party` : t`Watch together`
      }
      side="right"
      // Narrow, so a phone on its side keeps most of the video in view.
      size="sm"
      overlayClass="bg-black/40"
      contentClass="flex flex-col gap-0 overflow-hidden p-0"
      headerClass={cn(GUTTER, 'pb-3 pt-[calc(1rem+env(safe-area-inset-top))]')}
      closeClass="end-[max(0.5rem,env(safe-area-inset-right))] top-[calc(0.75rem+env(safe-area-inset-top))]"
    >
      {state && !invite ? (
        <InParty state={state} />
      ) : (
        <div
          data-nav-group
          className={cn(
            GUTTER,
            'min-h-0 flex-1 overflow-y-auto pb-[calc(1rem+env(safe-area-inset-bottom))]'
          )}
        >
          {invite ? (
            <JoinPreview invite={invite} inParty={!!state} />
          ) : (
            <NotInParty opening={opening} />
          )}
        </div>
      )}
    </Drawer>
  );
}

const isCurrent = (invite: PartyInvite, state: PartyState | null) =>
  state?.invite.relay === invite.relay && state.invite.code === invite.code;
