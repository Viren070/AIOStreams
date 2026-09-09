import { z } from 'zod';
import type { RuntimeConfigSection } from '../types.js';

/**
 * Watch state exchanged with addons that declare the `watch_state` resource. The
 * two directions are separate switches: an instance may reasonably want to read
 * tracker state without sending anything out, or the reverse. Only the Jellyfin
 * API produces the events that are sent.
 */
export const watchStateSchema = {
  reportEnabled: {
    schema: z.boolean(),
    default: false,
    label: 'Report playback to addons',
    description:
      'Sends playback events (started, paused, stopped with a watched decision, marked played or unplayed) to configured addons that declare the `watch_state` resource, so a tracker addon can scrobble what was actually watched instead of guessing from a subtitle request. Only Jellyfin clients produce these events; playback in Stremio reports nothing.',
    env: 'WATCH_STATE_REPORT_ENABLED',
    requiresRestart: false,
    secret: false,
  },
  pullEnabled: {
    schema: z.boolean(),
    default: false,
    label: 'Read watch state from addons',
    description:
      'Reads back what a tracker addon knows you have watched and how far into things you are, so Continue Watching and Next Up in a Jellyfin client reflect what you watched on other devices. Requires an addon that answers the `watch_state` resource; what it returns replaces what was imported from it before, and never overrides something you played here.',
    env: 'WATCH_STATE_PULL_ENABLED',
    requiresRestart: false,
    secret: false,
  },
  allowPrivateUrls: {
    schema: z.boolean(),
    default: false,
    label: 'Allow exchanging with private addresses',
    description:
      'Allow playback events to be sent to, and watch state read from, an addon on a private or loopback address, such as `http://tracker:7000` on a Docker network. This lets anyone who can create a configuration make this server send requests to your internal network, so only enable it on a trusted, non-public instance.',
    env: 'WATCH_STATE_ALLOW_PRIVATE_URLS',
    requiresRestart: false,
    secret: false,
  },
  maxSinks: {
    schema: z.number().int().min(0),
    default: 3,
    label: 'Max addons exchanged with',
    description:
      'How many addons one configuration may exchange watch state with. A fan-out cap, not a permission: every addon that declares the resource is eligible, this bounds how many requests one play can turn into. 0 disables the exchange.',
    env: 'WATCH_STATE_MAX_SINKS',
    requiresRestart: false,
    secret: false,
    ui: { min: 0 },
  },
  deliveryIntervalSeconds: {
    schema: z.number().int().min(10),
    default: 60,
    label: 'Delivery interval (seconds)',
    description:
      'How often queued playback events are delivered. Events are queued before the request that produced them returns, so an addon being down or slow never delays playback; this is how long a scrobble waits in the normal case.',
    env: 'WATCH_STATE_DELIVERY_INTERVAL',
    requiresRestart: true,
    secret: false,
    ui: { min: 10 },
  },
  deliveryMaxAttempts: {
    schema: z.number().int().min(1).max(20),
    default: 5,
    label: 'Delivery attempts',
    description:
      'How many times a playback event is retried before it is given up on. Backoff runs 30 seconds, 2 minutes, 10 minutes, 1 hour, 6 hours, so the default covers an addon being down for most of a day.',
    env: 'WATCH_STATE_DELIVERY_MAX_ATTEMPTS',
    requiresRestart: false,
    secret: false,
    ui: { min: 1, max: 20 },
  },
  deliveryRetentionDays: {
    schema: z.number().int().min(1),
    default: 7,
    label: 'Delivery history retention (days)',
    description:
      'Delivered and given-up playback events are deleted by the daily prune task after this long. They are kept only so a failing addon can be diagnosed.',
    env: 'WATCH_STATE_DELIVERY_RETENTION_DAYS',
    requiresRestart: false,
    secret: false,
    ui: { min: 1 },
  },
  pullIntervalSeconds: {
    schema: z.number().int().min(60),
    default: 1800,
    label: 'Background read interval (seconds)',
    description:
      'How often watch state is read from addons in the background. Each read sends back the last version the addon gave, so an addon whose state has not changed answers without touching its tracker; this is the pace of that check, not of a full re-read.',
    env: 'WATCH_STATE_PULL_INTERVAL',
    requiresRestart: true,
    secret: false,
    ui: { min: 60 },
  },
  pullTtlSeconds: {
    schema: z.number().int().min(0),
    default: 300,
    label: 'Read on demand after (seconds)',
    description:
      'When a Jellyfin client asks for Continue Watching or Next Up and the last read is older than this, a fresh one is started in the background. The shelf is always answered from what is already stored, so a slow addon never delays it; the new state appears on the next refresh.',
    env: 'WATCH_STATE_PULL_TTL',
    requiresRestart: false,
    secret: false,
    ui: { min: 0 },
  },
  echoWindowSeconds: {
    schema: z.number().int().min(0),
    default: 600,
    label: 'Echo window (seconds)',
    description:
      'How long something you played here is protected from being overwritten by reading it back. We report a watch to the addon, the addon writes it to a tracker, and the tracker stamps it a moment later than we did, so a plain "newer wins" rule would treat our own scrobble as fresh activity from another device. Nothing within this window is imported over.',
    env: 'WATCH_STATE_ECHO_WINDOW',
    requiresRestart: false,
    secret: false,
    ui: { min: 0 },
  },
  retentionDays: {
    schema: z.number().int().min(1),
    default: 365,
    label: 'Watch state retention (days)',
    description:
      'Watch progress, played flags and favourites untouched for longer than this are deleted by the daily prune task. State read from an addon is refreshed on every successful read, so it only ages out once that addon stops reporting it.',
    env: 'WATCH_STATE_RETENTION_DAYS',
    requiresRestart: false,
    secret: false,
    ui: { min: 1 },
  },
  sessionIdleTimeout: {
    schema: z.number().int().min(60),
    default: 300,
    label: 'Idle playback timeout (seconds)',
    description:
      'How long a playback may go without a report from the client before it is treated as over and stopped at the last position it sent. A client that crashes, loses its network or is force-quit never says it stopped, and without this the title would sit in Continue Watching for ever and never scrobble. Jellyfin itself uses 5 minutes. Paused clients keep reporting, so pausing does not trip it.',
    env: 'WATCH_STATE_SESSION_IDLE_TIMEOUT',
    requiresRestart: false,
    secret: false,
    ui: { min: 60 },
  },
  sessionSweepIntervalSeconds: {
    schema: z.number().int().min(15),
    default: 60,
    label: 'Idle playback check interval (seconds)',
    description:
      'How often playbacks are checked for having gone idle. Lower means an abandoned playback is closed sooner, at the cost of one small query per interval.',
    env: 'WATCH_STATE_SESSION_SWEEP_INTERVAL',
    requiresRestart: true,
    secret: false,
    ui: { min: 15 },
  },
} as const satisfies RuntimeConfigSection;
