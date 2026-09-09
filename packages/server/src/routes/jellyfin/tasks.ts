import {
  config as appConfig,
  deliverPlaybackEvents,
  JellyfinRepository,
  PlaybackHandoffRepository,
  pullPlaybackState,
  sweepIdleWatchSessions,
  TaskManager,
  WatchStateRepository,
} from '@aiostreams/core';

const ID_MAP_MAX_AGE_MS = 180 * 24 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;

export function registerJellyfinTasks(): void {
  TaskManager.register({
    id: 'jellyfin-prune',
    label: 'Prune Jellyfin state',
    description:
      'Deletes hashed Jellyfin item ids not seen for 180 days and watch state untouched for longer than the configured retention. Browsing re-creates ids; watch state is gone for good.',
    category: 'jellyfin',
    kind: 'scheduled',
    intervalMs: DAY_MS,
    enabled: true,
    destructive: true,
    multiReplica: 'single',
    run: async () => {
      const ids = await JellyfinRepository.pruneIds(ID_MAP_MAX_AGE_MS);
      const retentionMs = appConfig.watchState.retentionDays * DAY_MS;
      const rows = await WatchStateRepository.prune(retentionMs);
      const deliveries = await PlaybackHandoffRepository.pruneFinished(
        Date.now() - appConfig.watchState.deliveryRetentionDays * DAY_MS
      );
      return {
        ok: true,
        message: `pruned ${ids} id mappings, ${rows} watch-state rows and ${deliveries} playback deliveries`,
      };
    },
  });

  TaskManager.register({
    id: 'watch-session-sweep',
    label: 'Close abandoned playbacks',
    description:
      'Stops playbacks that have gone quiet at the last position the client reported. A client that crashes or loses its network never says it stopped, so without this the title stays in Continue Watching for ever and never scrobbles.',
    category: 'jellyfin',
    kind: 'scheduled',
    intervalMs: appConfig.watchState.sessionSweepIntervalSeconds * 1000,
    enabled: true,
    destructive: false,
    multiReplica: 'single',
    run: async () => {
      const { closed, reported } = await sweepIdleWatchSessions();
      return {
        ok: true,
        message: closed
          ? `closed ${closed} abandoned playback(s), reported ${reported}`
          : 'nothing abandoned',
      };
    },
  });

  TaskManager.register({
    id: 'watch-state-pull',
    label: 'Read watch state from addons',
    description:
      'Asks each addon that answers the watch_state resource what it knows you have watched, so Continue Watching and Next Up reflect other devices. Each request carries the version last seen, so an addon with nothing new answers without touching its tracker.',
    category: 'jellyfin',
    kind: 'scheduled',
    intervalMs: appConfig.watchState.pullIntervalSeconds * 1000,
    enabled: true,
    destructive: false,
    multiReplica: 'single',
    run: async () => {
      if (!appConfig.watchState.pullEnabled)
        return { ok: true, message: 'reading watch state is disabled' };
      const { sinks, items, watched, removed } = await pullPlaybackState();
      return {
        ok: true,
        message: `read ${sinks} addon(s): ${items} in progress, ${watched} watched, ${removed} no longer reported`,
      };
    },
  });

  TaskManager.register({
    id: 'playback-handoff-delivery',
    label: 'Deliver playback events',
    description:
      'Sends queued playback events to addons that declare the watch_state resource. Events are queued before the client request that produced them returns, so delivery never delays playback.',
    category: 'jellyfin',
    kind: 'scheduled',
    intervalMs: appConfig.watchState.deliveryIntervalSeconds * 1000,
    enabled: true,
    destructive: false,
    multiReplica: 'single',
    run: async () => {
      if (!appConfig.watchState.reportEnabled)
        return { ok: true, message: 'playback reporting disabled' };
      const { delivered, failed, retried } = await deliverPlaybackEvents();
      return {
        ok: true,
        message: `delivered ${delivered}, retrying ${retried}, gave up on ${failed}`,
      };
    },
  });
}
