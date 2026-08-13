export function withInternalTimeoutMargin(
  configuredTimeout: number | undefined,
  internalTimeout: number,
  margin = 3_000
): number {
  return Math.max(configuredTimeout ?? 0, internalTimeout + margin);
}
