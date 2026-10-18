/** Stop waiting on cancellation, including operations backed by a cache. */
export async function untilAborted<T>(
  operation: Promise<T>,
  signal?: AbortSignal
): Promise<T | undefined> {
  if (!signal) return operation;
  if (signal.aborted) {
    void operation.catch(() => {});
    return undefined;
  }
  let abort: () => void;
  const cancelled = new Promise<undefined>((resolve) => {
    abort = () => resolve(undefined);
    signal.addEventListener('abort', abort, { once: true });
  });
  try {
    return await Promise.race([operation, cancelled]);
  } finally {
    signal.removeEventListener('abort', abort!);
  }
}
