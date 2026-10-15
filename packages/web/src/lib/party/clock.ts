const SAMPLES = 8;

/** This device's clock, whose readings never jump when the system time is set. */
export const monotonic = () => performance.now();

/**
 * The relay's clock, from ping round trips. The trip that took least time says
 * the most about the offset, so of the last few, that one is used. Until the
 * first, it reads this device's wall clock.
 */
export class RelayClock {
  private samples: { offset: number; rtt: number }[] = [];
  offset = Date.now() - monotonic();
  rtt = 0;

  get synced(): boolean {
    return this.samples.length > 0;
  }

  /** Sent at `t0` and back at `t3` on `monotonic`; received and answered at `t1` and `t2`. */
  add(t0: number, t1: number, t2: number, t3: number): void {
    const rtt = t3 - t0 - (t2 - t1);
    if (rtt < 0) return;
    this.samples = [
      ...this.samples.slice(-(SAMPLES - 1)),
      { offset: (t1 - t0 + (t2 - t3)) / 2, rtt },
    ];
    const best = this.samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
    this.offset = best.offset;
    this.rtt = best.rtt;
  }

  now(): number {
    return monotonic() + this.offset;
  }

  reset(): void {
    this.samples = [];
    this.offset = Date.now() - monotonic();
  }
}
