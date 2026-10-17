import { t } from '@lingui/core/macro';
import { toast } from 'sonner';
import { useHeldInvites } from '../../lib/party/actions';
import { usePartyFollow } from '../../lib/party/follow';
import { usePartyEvent } from '../../lib/party/party';
import {
  closePartySheet,
  openPartySheet,
  PartySheet,
  usePartySheetOpen,
} from './party-sheet';

const onPlayer = () => /^#\/play\//.test(window.location.hash);

/** What a party needs whatever page is open. Once, in the layout. */
export function PartyHost() {
  useHeldInvites((invite) => openPartySheet({ invite }));
  // The video is what someone joining came for.
  usePartyFollow(closePartySheet);
  const sheetOpen = usePartySheetOpen();
  usePartyEvent((event) => {
    switch (event.type) {
      case 'members':
        if (event.joined) {
          const { name } = event.joined;
          toast(t`${name} joined the party`);
        }
        if (event.left) {
          const { name } = event.left;
          toast(t`${name} left the party`);
        }
        return;
      case 'chat':
        // The player shows messages over the video, and the panel lists them.
        if (!event.message.you && !sheetOpen && !onPlayer())
          toast(`${event.message.name}: ${event.message.text}`);
        return;
      case 'notice':
        return void toast.error(event.text);
      case 'ended':
        return void toast(event.reason);
    }
  });
  return <PartySheet />;
}
