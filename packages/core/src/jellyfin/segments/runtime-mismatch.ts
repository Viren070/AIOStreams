/** Metadata runtimes are rounded, and releases of one cut differ by a few minutes. */
const RUNTIME_TOLERANCE = 0.15;

/** Whether the file is another cut than the runtime's, such as an extended edition. */
export function isRuntimeMismatch(
  runtimeMs?: number,
  fileMs?: number
): boolean {
  if (!runtimeMs || !fileMs) return false;
  return Math.abs(fileMs - runtimeMs) > runtimeMs * RUNTIME_TOLERANCE;
}
