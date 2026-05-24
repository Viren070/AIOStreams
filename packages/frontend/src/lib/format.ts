/**
 * Compact number formatting for dashboard stats. Large values collapse to a
 * K / M / B suffix with smart precision: one decimal place while the scaled
 * value is below 100 (e.g. `1.2K`, `12.3M`), none above it (e.g. `123K`,
 * `500K`). Trailing `.0` is dropped, and anything under 1,000 is shown in full.
 */
export function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const abs = Math.abs(value);
  if (abs < 1000) return value.toLocaleString();

  const units = [
    { v: 1e9, s: 'B' },
    { v: 1e6, s: 'M' },
    { v: 1e3, s: 'K' },
  ];
  for (const u of units) {
    if (abs >= u.v) {
      const scaled = value / u.v;
      const decimals = Math.abs(scaled) < 100 ? 1 : 0;
      let str = scaled.toFixed(decimals);
      if (str.endsWith('.0')) str = str.slice(0, -2);
      return str + u.s;
    }
  }
  return value.toLocaleString();
}
