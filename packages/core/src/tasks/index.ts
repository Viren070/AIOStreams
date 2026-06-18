/**
 * Central background-task registry/scheduler.
 *
 * Replaces ad-hoc `setInterval` loops with one introspectable registry so the
 * dashboard Tasks page can list every task, its schedule, last/next run, and
 * trigger the manual ones. App-lifetime work only — per-request/per-session
 * timers (debrid keepalive, SSE heartbeats) are intentionally out of scope.
 */
import { createLogger } from '../logging/logger.js';

const logger = createLogger('tasks');

export type TaskCategory =
  | 'maintenance'
  | 'data-sync'
  | 'cache'
  | 'users'
  | 'templates'
  | 'analytics'
  | 'usenet';

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
  /** `single` ⇒ cluster-wide single-run (guarded elsewhere); `all` ⇒ per-process. */
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
  lastRunAt: number | null;
  lastDurationMs: number | null;
  lastStatus: 'ok' | 'error' | 'skipped' | null;
  lastError: string | null;
  nextRunAt: number | null;
}

interface Entry {
  def: TaskDefinition;
  timer: NodeJS.Timeout | null;
  retryTimer: NodeJS.Timeout | null;
  running: boolean;
  lastRunAt: number | null;
  lastDurationMs: number | null;
  lastStatus: 'ok' | 'error' | 'skipped' | null;
  lastError: string | null;
  nextRunAt: number | null;
}

// Node.js setTimeout only accepts values up to 2^31-1 ms; larger values
// wrap to 1 ms. Clamp here so misconfigured intervals fail loudly instead.
const MAX_TIMEOUT_MS = 2_147_483_647;

class TaskManagerImpl {
  private tasks = new Map<string, Entry>();

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
    if (def.kind === 'scheduled' && def.enabled && def.intervalMs) {
      this.schedule(entry);
    }
  }

  unregister(id: string): void {
    const e = this.tasks.get(id);
    if (e?.timer) clearTimeout(e.timer);
    if (e?.retryTimer) clearTimeout(e.retryTimer);
    this.tasks.delete(id);
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
      void this.execute(entry, false).catch(() => undefined);
    }, clamped);
    entry.retryTimer.unref?.();
  }

  async runNow(id: string): Promise<TaskResult> {
    const e = this.tasks.get(id);
    if (!e) return { ok: false, message: 'unknown task' };
    if (!e.def.enabled) return { ok: false, message: 'task is disabled' };
    if (e.running) return { ok: false, message: 'already running' };
    return this.execute(e, true);
  }

  isRunning(id: string): boolean {
    return this.tasks.get(id)?.running ?? false;
  }

  list(): TaskState[] {
    return [...this.tasks.values()].map((e) => ({
      id: e.def.id,
      label: e.def.label,
      description: e.def.description,
      category: e.def.category,
      kind: e.def.kind,
      intervalMs: e.def.intervalMs,
      enabled: e.def.enabled,
      destructive: e.def.destructive,
      multiReplica: e.def.multiReplica,
      running: e.running,
      lastRunAt: e.lastRunAt,
      lastDurationMs: e.lastDurationMs,
      lastStatus: e.lastStatus,
      lastError: e.lastError,
      nextRunAt: e.nextRunAt,
    }));
  }

  stopAll(): void {
    for (const e of this.tasks.values()) {
      if (e.timer) clearTimeout(e.timer);
      if (e.retryTimer) clearTimeout(e.retryTimer);
    }
  }
}

export const TaskManager = new TaskManagerImpl();
