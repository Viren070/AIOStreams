import { config as appConfig, type PartyRelayMode } from '@aiostreams/core';

/** Who may use this relay; `users` needs sign-in on the config page, else anyone could make a user. */
export function relayMode(): PartyRelayMode {
  const mode = appConfig.party.relay;
  return mode === 'users' && !appConfig.api.authRequired ? 'off' : mode;
}
