import type { Invite as PartyInvite } from '@/lib/party/invite';
import { createLive, useLive } from '@/lib/live-value';

export interface Opening {
  /** What starting a party plays for it, once it has started. */
  play?: { title: string; run(): unknown };
  /** A party to look at before joining. */
  invite?: PartyInvite;
}

interface Sheet {
  open: boolean;
  opening: Opening;
}

const sheet = createLive<Sheet>({ open: false, opening: {} });

const setSheet = (next: Partial<Sheet>) =>
  sheet.set({ ...sheet.get(), ...next });

export const openPartySheet = (opening: Opening = {}) =>
  setSheet({ open: true, opening });

export const closePartySheet = () => setSheet({ open: false });

export const showInvite = (invite?: PartyInvite) =>
  setSheet({ opening: { ...sheet.get().opening, invite } });

export const useSheet = () => useLive(sheet);

export const usePartySheetOpen = () => useSheet().open;
