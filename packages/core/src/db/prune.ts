import { config as appConfig } from '../config/index.js';

export interface PruneResult {
  deleted: number;
  /** False when the budget ran out with rows still to delete. */
  exhausted: boolean;
}

/**
 * Deletes in bounded batches until there is nothing left or time runs out.
 *
 * The pause between batches is what lets other queries through: on SQLite they
 * all queue behind one connection, on PostgreSQL a long delete holds its locks
 * and produces its bloat in one burst. Anything left is picked up next run.
 */
export async function deleteInBatches(
  step: () => Promise<number>,
  opts: { budgetMs?: number; pauseMs?: number } = {}
): Promise<PruneResult> {
  const budgetMs =
    opts.budgetMs ?? appConfig.watchState.pruneBudgetSeconds * 1000;
  const pauseMs = opts.pauseMs ?? 50;
  const deadline = Date.now() + budgetMs;
  let deleted = 0;
  for (;;) {
    const n = await step();
    deleted += n;
    if (n === 0) return { deleted, exhausted: true };
    if (Date.now() >= deadline) return { deleted, exhausted: false };
    await new Promise((r) => setTimeout(r, pauseMs));
  }
}
