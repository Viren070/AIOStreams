/**
 * Engine-wide free list of task slot buffers, so a new range stream (every
 * player seek) reuses the previous stream's slots.
 */
export class SlotBank {
  private free: Buffer[] = [];
  private bytes = 0;

  /** Slots beyond `capBytes` are dropped instead of banked. */
  constructor(private readonly capBytes: number) {}

  /** Smallest banked slot of at least `need` bytes, if any. */
  take(need: number): Buffer | undefined {
    let best = -1;
    for (let i = 0; i < this.free.length; i++) {
      const len = this.free[i].length;
      if (len >= need && (best < 0 || len < this.free[best].length)) best = i;
    }
    if (best < 0) return undefined;
    const buf = this.free.splice(best, 1)[0];
    this.bytes -= buf.length;
    return buf;
  }

  /** Bank a slot nothing references any more; dropped when over the cap. */
  give(buf: Buffer): void {
    if (this.bytes + buf.length > this.capBytes) return;
    this.free.push(buf);
    this.bytes += buf.length;
  }

  clear(): void {
    this.free = [];
    this.bytes = 0;
  }

  stats(): { slots: number; bytes: number } {
    return { slots: this.free.length, bytes: this.bytes };
  }
}
