import { z } from 'zod';
import { byteSize, seconds } from './helpers.js';
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
    default: true,
    label: 'Report playback to addons',
    description:
      'Sends playback events (started, paused, stopped with a watched decision, marked played or unplayed) to configured addons that declare the `watch_state` resource, so a tracker addon can scrobble what was actually watched instead of guessing from a subtitle request. Only Jellyfin clients produce these events; playback in Stremio reports nothing.',
    env: 'WATCH_STATE_REPORT_ENABLED',
    requiresRestart: false,
    secret: false,
  },
  pullEnabled: {
    schema: z.boolean(),
    default: true,
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
      'How many addons each Jellyfin user may exchange watch state with. A fan-out cap, not a permission: every addon that declares the resource is eligible, this bounds how many requests one play can turn into. 0 disables the exchange.',
    env: 'WATCH_STATE_MAX_SINKS',
    requiresRestart: false,
    secret: false,
    ui: { min: 0 },
  },
  deliveryIntervalSeconds: {
    schema: seconds.pipe(z.number().min(10)),
    default: 60,
    label: 'Delivery interval',
    description:
      'How often queued playback events are delivered. Events are queued before the request that produced them returns, so an addon being down or slow never delays playback; this is how long a scrobble waits in the normal case.',
    env: 'WATCH_STATE_DELIVERY_INTERVAL',
    requiresRestart: true,
    secret: false,
    ui: { kind: 'duration' },
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
    schema: seconds.pipe(z.number().min(60)),
    default: 1800,
    label: 'Background read interval',
    description:
      'How often watch state is read from addons in the background. Each read sends back the last version the addon gave, so an addon whose state has not changed answers without touching its tracker; this is the pace of that check, not of a full re-read.',
    env: 'WATCH_STATE_PULL_INTERVAL',
    requiresRestart: true,
    secret: false,
    ui: { kind: 'duration' },
  },
  pullTtlSeconds: {
    schema: seconds,
    default: 300,
    label: 'Read on demand after',
    description:
      'When a Jellyfin client asks for Continue Watching or Next Up and the last read is older than this, a fresh one is started in the background. The shelf is always answered from what is already stored, so a slow addon never delays it; the new state appears on the next refresh.',
    env: 'WATCH_STATE_PULL_TTL',
    requiresRestart: false,
    secret: false,
    ui: { kind: 'duration' },
  },
  echoWindowSeconds: {
    schema: seconds,
    default: 600,
    label: 'Echo window',
    description:
      'How long something you played here is protected from being overwritten by reading it back. We report a watch to the addon, the addon writes it to a tracker, and the tracker stamps it a moment later than we did, so a plain "newer wins" rule would treat our own scrobble as fresh activity from another device. Nothing within this window is imported over.',
    env: 'WATCH_STATE_ECHO_WINDOW',
    requiresRestart: false,
    secret: false,
    ui: { kind: 'duration' },
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
    schema: seconds.pipe(z.number().min(60)),
    default: 300,
    label: 'Idle playback timeout',
    description:
      'How long a playback may go without a report from the client before it is treated as over and stopped at the last position it sent. A client that crashes, loses its network or is force-quit never says it stopped, and without this the title would sit in Continue Watching for ever and never scrobble. Jellyfin itself uses 5 minutes. Paused clients keep reporting, so pausing does not trip it.',
    env: 'WATCH_STATE_SESSION_IDLE_TIMEOUT',
    requiresRestart: false,
    secret: false,
    ui: { kind: 'duration' },
  },
  sessionSweepIntervalSeconds: {
    schema: seconds.pipe(z.number().min(15)),
    default: 60,
    label: 'Idle playback check interval',
    description:
      'How often playbacks are checked for having gone idle. Lower means an abandoned playback is closed sooner, at the cost of one small query per interval.',
    env: 'WATCH_STATE_SESSION_SWEEP_INTERVAL',
    requiresRestart: true,
    secret: false,
    ui: { kind: 'duration' },
  },
  deliveryMaxSinksPerRun: {
    schema: z.number().int().min(1),
    default: 100,
    label: 'Addons per delivery run',
    description:
      'How many addons one delivery pass takes on. Each is leased for the length of the pass, so several instances share the queue rather than repeating each other. Raise it if the queue grows faster than it drains.',
    env: 'WATCH_STATE_DELIVERY_MAX_SINKS',
    requiresRestart: false,
    secret: false,
    ui: { min: 1 },
  },
  deliveryRowsPerSink: {
    schema: z.number().int().min(1),
    default: 20,
    label: 'Events per addon per run',
    description:
      'The most events sent to any one addon in a single pass. This is what stops one busy or slow addon from filling every pass and starving the rest.',
    env: 'WATCH_STATE_DELIVERY_ROWS_PER_SINK',
    requiresRestart: false,
    secret: false,
    ui: { min: 1 },
  },
  deliveryConcurrency: {
    schema: z.number().int().min(1).max(128),
    default: 16,
    label: 'Addons contacted at once',
    description:
      'How many addons are delivered to in parallel. Events for any one addon are always sent in order, one at a time, so this only widens how many addons progress together.',
    env: 'WATCH_STATE_DELIVERY_CONCURRENCY',
    requiresRestart: false,
    secret: false,
    ui: { min: 1, max: 128 },
  },
  deliveryBudgetSeconds: {
    schema: seconds.pipe(z.number().min(1)),
    default: 45,
    label: 'Delivery run budget',
    description:
      'How long a delivery pass keeps taking on new addons before it stops and leaves the rest to the next one. Keeps a run from overlapping the next when many addons are timing out.',
    env: 'WATCH_STATE_DELIVERY_BUDGET',
    requiresRestart: false,
    secret: false,
    ui: { kind: 'duration' },
  },
  deliveryMaxPendingPerSink: {
    schema: z.number().int().min(1),
    default: 2000,
    label: 'Queued events per addon',
    description:
      'How many events may wait for one addon before the oldest are dropped. Position pings go first; a watched or unwatched mark is only dropped if cutting those did not free enough, because nothing else carries it.',
    env: 'WATCH_STATE_DELIVERY_MAX_PENDING',
    requiresRestart: false,
    secret: false,
    ui: { min: 1 },
  },
  deliveryFailuresBeforeDisable: {
    schema: z.number().int().min(1).max(1000),
    default: 20,
    label: 'Failed runs before an addon is dropped',
    description:
      'Consecutive passes in which an addon accepted nothing before it stops receiving events and drops to an occasional probe. Any single success resets the count.',
    env: 'WATCH_STATE_DELIVERY_FAILURES_BEFORE_DISABLE',
    requiresRestart: false,
    secret: false,
    ui: { min: 1, max: 1000 },
  },
  sinkProbeMinutes: {
    schema: z.number().int().min(1),
    default: 60,
    label: 'Retry a dropped addon after (minutes)',
    description:
      'How long an addon that was dropped waits before one attempt is made again. This is the only way an addon whose credentials were since fixed comes back on its own.',
    env: 'WATCH_STATE_SINK_PROBE_MINUTES',
    requiresRestart: false,
    secret: false,
    ui: { min: 1 },
  },
  pullSweepIntervalSeconds: {
    schema: seconds.pipe(z.number().min(10)),
    default: 60,
    label: 'Read check interval',
    description:
      'How often this instance looks for addons due to be read from. Each addon is still read only once per the interval above; this is how finely that work is spread out.',
    env: 'WATCH_STATE_PULL_SWEEP_INTERVAL',
    requiresRestart: true,
    secret: false,
    ui: { kind: 'duration' },
  },
  pullMaxSinksPerRun: {
    schema: z.number().int().min(1),
    default: 100,
    label: 'Addons per read run',
    description:
      'How many addons one read pass takes on. Multiplied by how often the pass runs, this is the ceiling on how quickly the whole set can be worked through.',
    env: 'WATCH_STATE_PULL_MAX_SINKS',
    requiresRestart: false,
    secret: false,
    ui: { min: 1 },
  },
  pullConcurrency: {
    schema: z.number().int().min(1).max(64),
    default: 8,
    label: 'Addons read at once',
    description:
      'How many addons are read from in parallel. Each holds a database connection while it writes what it read, so on PostgreSQL keep this below the connection pool size.',
    env: 'WATCH_STATE_PULL_CONCURRENCY',
    requiresRestart: false,
    secret: false,
    ui: { min: 1, max: 64 },
  },
  pullBudgetSeconds: {
    schema: seconds.pipe(z.number().min(1)),
    default: 45,
    label: 'Read run budget',
    description:
      'How long a read pass keeps taking on new addons before leaving the rest to the next one.',
    env: 'WATCH_STATE_PULL_BUDGET',
    requiresRestart: false,
    secret: false,
    ui: { kind: 'duration' },
  },
  pullActiveWithinHours: {
    schema: z.number().int().min(0),
    default: 72,
    label: 'Only read for recent users (hours)',
    description:
      'Background reads skip configurations that have not opened a Jellyfin client for this long, so the budget goes to people who are actually watching. They still get a read on demand the moment they come back. Set 0 to read for everyone, which is what a private instance wants.',
    env: 'WATCH_STATE_PULL_ACTIVE_WITHIN_HOURS',
    requiresRestart: false,
    secret: false,
    ui: { min: 0 },
  },
  pullMaxResponseBytes: {
    schema: byteSize,
    default: 5 * 1000 * 1000,
    label: 'Largest watch-state response',
    description:
      'An addon answering with more than this is treated as having failed. Nothing is imported and nothing is removed, because a partial answer would look like the user had un-watched everything missing from it.',
    env: 'WATCH_STATE_PULL_MAX_RESPONSE_BYTES',
    requiresRestart: false,
    secret: false,
  },
  pullMaxItems: {
    schema: z.number().int().min(1),
    default: 5000,
    label: 'Most in-progress items accepted',
    description:
      'An answer listing more titles in progress than this is refused whole, for the same reason as the size limit.',
    env: 'WATCH_STATE_PULL_MAX_ITEMS',
    requiresRestart: false,
    secret: false,
    ui: { min: 1 },
  },
  pullMaxWatched: {
    schema: z.number().int().min(1),
    default: 50_000,
    label: 'Most watched items accepted',
    description:
      'An answer listing more watched titles than this is refused whole. Large libraries are normal, so this sits well above a realistic history.',
    env: 'WATCH_STATE_PULL_MAX_WATCHED',
    requiresRestart: false,
    secret: false,
    ui: { min: 1 },
  },
  progressFlushSeconds: {
    schema: seconds.pipe(z.number().min(1)),
    default: 10,
    label: 'Progress write interval',
    description:
      'How long a playback position is held in memory before being written. Clients report every 5 to 10 seconds, so this coalesces those into one write; it is also how much position is lost if the instance is killed outright.',
    env: 'WATCH_STATE_PROGRESS_FLUSH_INTERVAL',
    requiresRestart: true,
    secret: false,
    ui: { kind: 'duration' },
  },
  progressBufferMax: {
    schema: z.number().int().min(100),
    default: 10_000,
    label: 'Buffered playbacks',
    description:
      'How many playback positions are held at once before a write is forced. Reached only with more simultaneous viewers than the interval above can drain.',
    env: 'WATCH_STATE_PROGRESS_BUFFER_MAX',
    requiresRestart: false,
    secret: false,
    ui: { min: 100 },
  },
  pruneBatchSize: {
    schema: z.number().int().min(100),
    default: 1000,
    label: 'Rows deleted per batch',
    description:
      'Old watch state is deleted in batches of this size with a pause between them, so a large clear-out never holds the database for the whole delete.',
    env: 'WATCH_STATE_PRUNE_BATCH_SIZE',
    requiresRestart: false,
    secret: false,
    ui: { min: 100 },
  },
  pruneBudgetSeconds: {
    schema: seconds.pipe(z.number().min(1)),
    default: 60,
    label: 'Prune budget',
    description:
      'How long one prune run spends deleting before stopping. Whatever is left is picked up by the next run.',
    env: 'WATCH_STATE_PRUNE_BUDGET',
    requiresRestart: false,
    secret: false,
    ui: { kind: 'duration' },
  },
} as const satisfies RuntimeConfigSection;
