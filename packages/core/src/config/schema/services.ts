import { serviceCredentialsMap } from './helpers.js';
import type { RuntimeConfigSection } from '../types.js';

/**
 * Debrid service credentials.
 *
 * Both fields share the same shape:
 *   `Record<serviceId, Record<credentialId, string>>`.
 *
 * Env shape: one `serviceId.credentialId=value` entry per line.
 */
export const servicesSchema = {
  defaultCredentials: {
    schema: serviceCredentialsMap,
    default: {} as Record<string, Record<string, string>>,
    label: 'Default service credentials',
    description: {
      ui: 'Default credentials pre-filled into user configurations when not provided (users can still override them).',
      env:
        'Default credentials pre-filled into user configurations when not provided. Format: one `serviceId.credentialId=value` entry per line (use `\\n` if your environment cannot store multiline values). ' +
        'Service IDs: `realdebrid`, `alldebrid`, `premiumize`, `debridlink`, `torbox`, `offcloud`, `putio`, `easynews`, `easydebrid`, `debrider`, `pikpak`, `seedr`, `nzbdav`, `altmount`, `stremthru_newz`. ' +
        'Credential IDs vary by service (e.g. `apiKey`, `username`, `password`, `clientId`, `encodedToken`). ' +
        'Example: `realdebrid.apiKey=xxx` / `easynews.username=user` / `easynews.password=pass`.',
    },
    env: 'DEFAULT_SERVICE_CREDENTIALS',
    requiresRestart: false,
    secret: true,
    ui: { multiline: true },
  },
  forcedCredentials: {
    schema: serviceCredentialsMap,
    default: {} as Record<string, Record<string, string>>,
    label: 'Forced service credentials',
    description: {
      ui: 'Credentials that override whatever the user has configured (hidden from the user). Same format as default credentials.',
      env: 'Credentials that override whatever the user has configured and are hidden from the configuration UI. Same `serviceId.credentialId=value` per-line format and service/credential IDs as DEFAULT_SERVICE_CREDENTIALS.',
    },
    env: 'FORCED_SERVICE_CREDENTIALS',
    requiresRestart: false,
    secret: true,
    ui: { multiline: true },
  },
} as const satisfies RuntimeConfigSection;
