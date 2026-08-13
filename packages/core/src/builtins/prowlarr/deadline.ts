export async function collectProwlarrResultsUntilDeadline<T>(
  tasks: Array<Promise<T[]>>,
  deadlineMs: number,
  onError?: (error: unknown) => void
): Promise<T[]> {
  const results: T[] = [];
  let timeout: NodeJS.Timeout | undefined;
  const settled = Promise.allSettled(
    tasks.map(async (task) => {
      try {
        results.push(...(await task));
      } catch (error) {
        onError?.(error);
      }
    })
  );
  const deadline = new Promise<void>((resolve) => {
    timeout = setTimeout(resolve, Math.max(1, deadlineMs));
  });
  try {
    await Promise.race([settled, deadline]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
  return results;
}
