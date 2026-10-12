/** Only a provider-declared closed series has a usable cached upper bound. */
export function isClosedSeries(status: unknown): boolean {
  return (
    typeof status === 'string' &&
    ['ended', 'canceled', 'cancelled'].includes(status.trim().toLowerCase())
  );
}
