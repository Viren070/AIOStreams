import { z } from 'zod';
import { optionalUrlString, positiveInt, seconds } from './helpers.js';
import type { RuntimeConfigSection } from '../types.js';

/** Reports the AIOStreams apps send: how a run ended, the device and the recent log. */
export const appReportsSchema = {
  accept: {
    schema: z.enum(['off', 'users', 'public']),
    default: 'users',
    label: 'App reports',
    description:
      "Which reports this server keeps, for its admins to read in the dashboard. **off**: none, and the apps offer no way to send one here. **users**: those its own users send from the apps. **public**: those too, and any another server passes on, for a developer's server.",
    env: 'APP_REPORTS',
    requiresRestart: false,
    secret: false,
  },
  forwardTo: {
    schema: optionalUrlString,
    default: 'https://aiostreams.viren070.me',
    label: 'Developer for app reports',
    description:
      "Where a report goes when its sender also sends it to the developer: the address of an AIOStreams server that keeps reports from everyone. Passwords, tokens and configuration ids are taken out first. Leave it empty to offer no such choice; the developer's own server offers none either.",
    env: 'APP_REPORTS_FORWARD_TO',
    requiresRestart: false,
    secret: false,
  },
  max: {
    schema: positiveInt,
    default: 1000,
    label: 'Max app reports',
    description:
      'How many reports are kept at most; each new one past it deletes the oldest.',
    env: 'APP_REPORTS_MAX',
    requiresRestart: false,
    secret: false,
  },
  retention: {
    schema: seconds,
    default: 7 * 86400,
    label: 'App report retention',
    description: 'How long reports are kept before they are deleted.',
    env: 'APP_REPORTS_RETENTION',
    requiresRestart: false,
    secret: false,
    ui: { kind: 'duration' },
  },
} as const satisfies RuntimeConfigSection;
