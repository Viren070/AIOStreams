import React from 'react';
import type { Invite as PartyInvite } from '@/lib/party/invite';

export interface Opening {
  /** What starting a party plays for it, once it has started. */
  play?: { title: string; run(): unknown };
  /** A party to look at before joining. */
  invite?: PartyInvite;
}

let sheet: { open: boolean; opening: Opening } = { open: false, opening: {} };
const sheetListeners = new Set<() => void>();

function setSheet(next: Partial<typeof sheet>): void {
  sheet = { ...sheet, ...next };
  for (const listener of sheetListeners) listener();
}

export const openPartySheet = (opening: Opening = {}) =>
  setSheet({ open: true, opening });

export const closePartySheet = () => setSheet({ open: false });

export const showInvite = (invite?: PartyInvite) =>
  setSheet({ opening: { ...sheet.opening, invite } });

export function useSheet() {
  return React.useSyncExternalStore(
    (listener) => {
      sheetListeners.add(listener);
      return () => void sheetListeners.delete(listener);
    },
    () => sheet
  );
}

export const usePartySheetOpen = () => useSheet().open;
