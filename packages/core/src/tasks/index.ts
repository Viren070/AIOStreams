/**
 * Central background-task registry/scheduler.
 *
 * Replaces ad-hoc `setInterval` loops with one introspectable registry so the
 * dashboard Tasks page can list every task, its schedule, last/next run, and
 * trigger the manual ones. App-lifetime work only — per-request/per-session
 * timers (debrid keepalive, SSE heartbeats) are intentionally out of scope.
 */
import { createLogger } from '../logging/logger.js';
import {
  TaskStateRepository,
  type TaskRunStatus,
  type TaskScheduleRow,
} from '../db/repositories/tasks.js';

const logger = createLogger('tasks');

export type TaskCategory =
  | 'maintenance'
  | 'data-sync'
  | 'cache'
  | 'users'
  | 'templates'
  | 'analytics'
  | 'usenet'
  | 'community';

export interface TaskContext {
  signal?: AbortSignal;
}

export interface TaskResult {
  ok: boolean;
  message?: string;
}

export interface TaskDefinition {
  id: string;
  label: string;
  description: string;
  category: TaskCategory;
  /** `manual` tasks never auto-run. */
  kind: 'scheduled' | 'manual';
  /** Scheduled only — milliseconds. Sourced from existing config.tasks.* */
  intervalMs?: number;
  enabled: boolean;
  /** UI requires a typed/confirm dialog and the server re-checks. */
  destructive: boolean;
  /**
   * `single` ⇒ the run is claimed cluster-wide and one replica does it; `all`
   * ⇒ every process runs it on its own timer. A task that refreshes
   * process-local memory has to be `all` even when its expensive part is
   * deduped internally, or the replicas that lose the race never see the
   * update.
   */
  multiReplica: 'all' | 'single';
  /**
   * On a failed run (`{ ok: false }` or thrown error), schedule a one-shot
   * retry after this many milliseconds. Cleared on success or unregister.
   * Useful for tasks with long happy-path intervals (e.g. 24h dataset
   * refresh) that should retry sooner after a transient failure.
   */
  retryIntervalMs?: number;
  run(ctx: TaskContext): Promise<TaskResult | void>;
}

/** What one replica did the last time it ran a task. */
export interface TaskRunState {
  instanceId: string;
  /** The replica answering this request. */
  self: boolean;
  lastRunAt: number | null;
  lastDurationMs: number | null;
  lastStatus: TaskRunStatus | null;
  lastError: string | null;
}

export interface TaskState {
  id: string;
  label: string;
  description: string;
  category: TaskCategory;
  kind: 'scheduled' | 'manual';
  intervalMs?: number;
  enabled: boolean;
  destructive: boolean;
  multiReplica: 'all' | 'single';
  running: boolean;
  /**
   * The run this task is best described by: for `single` the newest across the
   * cluster, for `all` this replica's own. {@link runs} has the breakdown.
   */
  lastRunAt: number | null;
  lastDurationMs: number | null;
  lastStatus: TaskRunStatus | null;
  lastError: string | null;
  nextRunAt: number | null;
  /** Every replica that has run this task, newest first. */
  runs: TaskRunState[];
  /** Replica currently running a `single` task, when it is not this one. */
  claimedBy: string | null;
}

interface Entry {
  def: TaskDefinition;
  timer: NodeJS.Timeout | null;
  retryTimer: NodeJS.Timeout | null;
  running: boolean;
  lastRunAt: number | null;
  lastDurationMs: number | null;
  lastStatus: TaskRunStatus | null;
  lastError: string | null;
  nextRunAt: number | null;
}

// Node.js setTimeout only accepts values up to 2^31-1 ms; larger values
// wrap to 1 ms. Clamp here so misconfigured intervals fail loudly instead.
const MAX_TIMEOUT_MS = 2_147_483_647;

/** How often shared state is polled for due `single` tasks and run requests. */
const POLL_MS = 10_000;

/** How long a claim survives without a renewal. */
const CLAIM_TTL_MS = 60_000;

/** Renewal cadence. Two missed renewals still leave the claim held. */
const RENEW_EVERY_MS = CLAIM_TTL_MS / 3;

/** Age at which a replica's run record is assumed to be from a dead replica. */
const RUN_RETENTION_MS = 30 * 24 * 60 * 60_000;

class TaskManagerImpl {
  private tasks = new Map<string, Entry>();
  private poll: NodeJS.Timeout | null = null;
  /**
   * Identity this replica records its runs under. Injected, not derived: the
   * data-folder lookup it comes from would put this module in an import cycle.
   */
  private instance = 'local';
  /** Tasks whose coordination row this process has already created. */
  private seeded = new Set<string>();
  /** Newest run request already served here, per `all` task. */
  private honoured = new Map<string, number>();
  private lastPruneAt = 0;

  setInstanceId(id: string): void {
    if (id) this.instance = id;
  }

  get instanceId(): string {
    return this.instance;
  }

  register(def: TaskDefinition): void {
    if (this.tasks.has(def.id)) {
      logger.warn(`Task ${def.id} already registered; replacing`);
      this.unregister(def.id);
    }
    const entry: Entry = {
      def,
      timer: null,
      retryTimer: null,
      running: false,
      lastRunAt: null,
      lastDurationMs: null,
      lastStatus: null,
      lastError: null,
      nextRunAt: null,
    };
    this.tasks.set(def.id, entry);
    // `single` tasks are driven by the shared schedule instead.
    if (
      def.kind === 'scheduled' &&
      def.enabled &&
      def.intervalMs &&
      def.multiReplica === 'all'
    ) {
      this.schedule(entry);
    }
    this.startPolling();
  }

  unregister(id: string): void {
    const e = this.tasks.get(id);
    if (e?.timer) clearTimeout(e.timer);
    if (e?.retryTimer) clearTimeout(e.retryTimer);
    this.tasks.delete(id);
    this.seeded.delete(id);
    this.honoured.delete(id);
  }

  private schedule(entry: Entry): void {
    let interval = entry.def.intervalMs!;
    if (interval > MAX_TIMEOUT_MS) {
      logger.warn(
        { task: entry.def.id, intervalMs: interval, clampedMs: MAX_TIMEOUT_MS },
        'task interval exceeds 32-bit signed integer limit and would fire immediately - clamping to ~24.8 days. If this task has a configurable interval env var, it may still be set in milliseconds instead of seconds.'
      );
      interval = MAX_TIMEOUT_MS;
    }
    const tick = async () => {
      await this.execute(entry, false);
      entry.nextRunAt = Date.now() + interval;
      entry.timer = setTimeout(tick, interval);
      entry.timer.unref?.();
    };
    entry.nextRunAt = Date.now() + interval;
    entry.timer = setTimeout(tick, interval);
    entry.timer.unref?.();
  }

  // --- shared-state polling ------------------------------------------------

  private startPolling(): void {
    if (this.poll) return;
    this.poll = setInterval(() => {
      void this.tick().catch((err) => {
        logger.debug({ err }, 'task poll failed');
      });
    }, POLL_MS);
    this.poll.unref?.();
  }

  /**
   * One pass over the shared schedule: seed rows for newly-registered tasks,
   * run anything asked for out of band, claim any `single` task now due.
   */
  private async tick(): Promise<void> {
    if (this.tasks.size === 0) return;
    const schedule = new Map(
      (await TaskStateRepository.listSchedule()).map((r) => [r.taskId, r])
    );
    const now = Date.now();

    for (const entry of this.tasks.values()) {
      const { def } = entry;
      if (!this.seeded.has(def.id)) {
        const due =
          def.kind === 'scheduled' && def.enabled && def.intervalMs
            ? now + def.intervalMs
            : undefined;
        await TaskStateRepository.ensureSchedule(
          def.id,
          def.multiReplica === 'single' ? due : undefined
        );
        this.seeded.add(def.id);
        const existing = schedule.get(def.id);
        // A request already standing when this process started belongs to the
        // replicas that were up at the time, not to this one.
        if (existing?.runRequestedAt) {
          this.honoured.set(def.id, existing.runRequestedAt);
        }
        continue;
      }
      const row = schedule.get(def.id);
      if (!row || !def.enabled || entry.running) continue;

      if (def.multiReplica === 'single') {
        if (!this.isDue(row, now)) continue;
        void this.executeClaimed(entry, false).catch(() => undefined);
        continue;
      }
      const requested = row.runRequestedAt;
      if (requested && requested > (this.honoured.get(def.id) ?? 0)) {
        this.honoured.set(def.id, requested);
        void this.execute(entry, true).catch(() => undefined);
      }
    }

    if (now - this.lastPruneAt > 60 * 60_000) {
      this.lastPruneAt = now;
      await TaskStateRepository.pruneRuns(now - RUN_RETENTION_MS).catch(
        () => 0
      );
    }
  }

  /**
   * Only the schedule, never a pending request: a `single` task is covered
   * cluster-wide by whoever claims it, so nothing needs to broadcast one.
   */
  private isDue(row: TaskScheduleRow, now: number): boolean {
    if (row.claimExpiresAt && row.claimExpiresAt > now) return false;
    return row.nextRunAt !== undefined && row.nextRunAt <= now;
  }

  // --- execution -----------------------------------------------------------

  /**
   * Run a `single` task under a cluster-wide claim. A claim held elsewhere is
   * skipped rather than failed: the task is running, just not here.
   */
  private async executeClaimed(
    entry: Entry,
    manual: boolean
  ): Promise<TaskResult> {
    const id = entry.def.id;
    const now = Date.now();
    let owned = false;
    try {
      // An on-demand run is not due by the schedule; the request is the reason.
      owned = await (manual
        ? TaskStateRepository.claimNow(
            id,
            this.instance,
            now,
            now + CLAIM_TTL_MS
          )
        : TaskStateRepository.claimDue(
            id,
            this.instance,
            now,
            now + CLAIM_TTL_MS
          ));
    } catch (err) {
      // Fail closed: a broken claim must not let every replica through.
      logger.warn({ task: id, err }, 'could not claim task; skipping this run');
      return { ok: false, message: 'could not claim the task' };
    }
    if (!owned) {
      entry.lastStatus = 'skipped';
      entry.lastError = null;
      return { ok: true, message: 'another replica is running this task' };
    }

    const renew = setInterval(() => {
      void TaskStateRepository.renewClaim(
        id,
        this.instance,
        Date.now() + CLAIM_TTL_MS
      ).catch((err) => logger.debug({ task: id, err }, 'claim renewal failed'));
    }, RENEW_EVERY_MS);
    renew.unref?.();

    try {
      return await this.execute(entry, manual);
    } finally {
      clearInterval(renew);
      const nextRunAt =
        entry.def.kind === 'scheduled' &&
        entry.def.enabled &&
        entry.def.intervalMs
          ? Date.now() + Math.min(entry.def.intervalMs, MAX_TIMEOUT_MS)
          : undefined;
      await TaskStateRepository.releaseClaim(
        id,
        this.instance,
        nextRunAt
      ).catch((err) => {
        logger.debug({ task: id, err }, 'failed to release task claim');
      });
    }
  }

  private async execute(entry: Entry, manual: boolean): Promise<TaskResult> {
    if (entry.running) return { ok: false, message: 'already running' };
    entry.running = true;
    const started = Date.now();
    let result: TaskResult;
    try {
      result = (await entry.def.run({})) ?? { ok: true };
      entry.lastStatus = result.ok ? 'ok' : 'error';
      entry.lastError = result.ok ? null : (result.message ?? 'failed');
    } catch (err) {
      entry.lastStatus = 'error';
      entry.lastError = err instanceof Error ? err.message : String(err);
      logger.warn(
        { task: entry.def.id, err: entry.lastError, manual },
        'task failed'
      );
      result = { ok: false, message: entry.lastError };
    } finally {
      entry.running = false;
      entry.lastRunAt = started;
      entry.lastDurationMs = Date.now() - started;
    }
    await TaskStateRepository.recordRun({
      taskId: entry.def.id,
      instanceId: this.instance,
      lastRunAt: entry.lastRunAt!,
      lastDurationMs: entry.lastDurationMs ?? undefined,
      lastStatus: entry.lastStatus ?? undefined,
      lastError: entry.lastError ?? undefined,
    }).catch((err) => {
      logger.debug({ task: entry.def.id, err }, 'failed to record task run');
    });
    this.applyRetryPolicy(entry, result);
    return result;
  }

  /**
   * After every run, (re)evaluate the retry timer:
   *   - success ⇒ clear any pending retry (next run is the normal interval)
   *   - failure + `retryIntervalMs` configured ⇒ schedule a one-shot retry
   * The scheduled interval tick is left untouched; a successful retry simply
   * means the next interval tick is the next attempt.
   */
  private applyRetryPolicy(entry: Entry, result: TaskResult): void {
    if (entry.retryTimer) {
      clearTimeout(entry.retryTimer);
      entry.retryTimer = null;
    }
    if (result.ok) return;
    const delay = entry.def.retryIntervalMs;
    if (!delay || delay <= 0 || !entry.def.enabled) return;
    const clamped = Math.min(delay, MAX_TIMEOUT_MS);
    logger.info(
      { task: entry.def.id, retryInMs: clamped },
      'task failed; scheduling retry'
    );
    entry.retryTimer = setTimeout(() => {
      entry.retryTimer = null;
      // Claimed as on-demand: a retry is not on the schedule.
      const run =
        entry.def.multiReplica === 'single'
          ? this.executeClaimed(entry, true)
          : this.execute(entry, false);
      void run.catch(() => undefined);
    }, clamped);
    entry.retryTimer.unref?.();
  }

  /**
   * Run a task on this replica now, claiming first if it is `single`. For work
   * only this process needs, such as loading a dataset it is missing;
   * {@link requestRun} is the cluster-wide door.
   */
  async runNow(id: string): Promise<TaskResult> {
    const e = this.tasks.get(id);
    if (!e) return { ok: false, message: 'unknown task' };
    if (!e.def.enabled) return { ok: false, message: 'task is disabled' };
    if (e.running) return { ok: false, message: 'already running' };
    if (e.def.multiReplica !== 'single') return this.execute(e, true);
    // The row may not be seeded yet; the claim is an UPDATE and needs one.
    await TaskStateRepository.ensureSchedule(id).catch(() => undefined);
    return this.executeClaimed(e, true);
  }

  /**
   * Ask the whole cluster to run a task, and run it here too. Fanning out is
   * the only way a manual run reaches replicas the HTTP request never hit.
   */
  async requestRun(id: string): Promise<TaskResult> {
    const e = this.tasks.get(id);
    if (!e) return { ok: false, message: 'unknown task' };
    if (!e.def.enabled) return { ok: false, message: 'task is disabled' };
    if (e.def.multiReplica === 'single') return this.runNow(id);

    const at = Date.now();
    await TaskStateRepository.requestRun(id, at).catch(() => undefined);
    this.honoured.set(id, at);
    const result = await this.execute(e, true);
    // Cleared so the flag does not sit there re-triggering. A replica that has
    // not polled within this run misses the request.
    await TaskStateRepository.clearRequest(id, at).catch(() => undefined);
    return result;
  }

  isRunning(id: string): boolean {
    return this.tasks.get(id)?.running ?? false;
  }

  /** Definitions and this replica's own view; no database read. */
  get(id: string): TaskDefinition | undefined {
    return this.tasks.get(id)?.def;
  }

  /** Every task, merged with what the rest of the cluster has recorded. */
  async list(): Promise<TaskState[]> {
    let runsByTask = new Map<string, TaskRunState[]>();
    let schedule = new Map<string, TaskScheduleRow>();
    try {
      const [runs, rows] = await Promise.all([
        TaskStateRepository.listRuns(),
        TaskStateRepository.listSchedule(),
      ]);
      for (const r of runs) {
        const list = runsByTask.get(r.taskId) ?? [];
        list.push({
          instanceId: r.instanceId,
          self: r.instanceId === this.instance,
          lastRunAt: r.lastRunAt,
          lastDurationMs: r.lastDurationMs ?? null,
          lastStatus: r.lastStatus ?? null,
          lastError: r.lastError ?? null,
        });
        runsByTask.set(r.taskId, list);
      }
      schedule = new Map(rows.map((r) => [r.taskId, r]));
    } catch (err) {
      logger.debug({ err }, 'failed to read shared task state');
      runsByTask = new Map();
    }

    const now = Date.now();
    return [...this.tasks.values()].map((e) => {
      const runs = runsByTask.get(e.def.id) ?? [];
      const row = schedule.get(e.def.id);
      const single = e.def.multiReplica === 'single';
      // A `single` task is one job wherever it ran, so the newest run describes
      // it. An `all` task is a different job per replica, so this one's does.
      const headline = single
        ? runs[0]
        : runs.find((r) => r.self) ||
          (e.lastRunAt !== null
            ? {
                instanceId: this.instance,
                self: true,
                lastRunAt: e.lastRunAt,
                lastDurationMs: e.lastDurationMs,
                lastStatus: e.lastStatus,
                lastError: e.lastError,
              }
            : undefined);
      const claimedElsewhere =
        row?.claimedBy &&
        row.claimedBy !== this.instance &&
        (row.claimExpiresAt ?? 0) > now
          ? row.claimedBy
          : null;
      return {
        id: e.def.id,
        label: e.def.label,
        description: e.def.description,
        category: e.def.category,
        kind: e.def.kind,
        intervalMs: e.def.intervalMs,
        enabled: e.def.enabled,
        destructive: e.def.destructive,
        multiReplica: e.def.multiReplica,
        running: e.running || claimedElsewhere !== null,
        lastRunAt: headline?.lastRunAt ?? null,
        lastDurationMs: headline?.lastDurationMs ?? null,
        lastStatus: headline?.lastStatus ?? null,
        lastError: headline?.lastError ?? null,
        nextRunAt: single ? (row?.nextRunAt ?? null) : e.nextRunAt,
        runs,
        claimedBy: claimedElsewhere,
      };
    });
  }

  stopAll(): void {
    if (this.poll) clearInterval(this.poll);
    this.poll = null;
    for (const e of this.tasks.values()) {
      if (e.timer) clearTimeout(e.timer);
      if (e.retryTimer) clearTimeout(e.retryTimer);
    }
  }
}

export const TaskManager = new TaskManagerImpl();
