import type { LiveStreamCounts } from '@fastighetsradar/domain';

export const STREAM_MAX_TOTAL = 1_000;
export const STREAM_WARN_AT = 800;

/** Counts accepted HTTP streams for the lifetime of one API instance. */
export class LiveStreamCounter {
  private opened = 0;
  private closed = 0;
  private peak = 0;

  constructor(private readonly warn: (counts: LiveStreamCounts) => void) {}

  get current() { return this.opened - this.closed; }

  snapshot(): LiveStreamCounts {
    return { opened: this.opened, closed: this.closed, current: this.current, peak: this.peak };
  }

  open(): () => void {
    this.opened++;
    if (this.current > this.peak) {
      this.peak = this.current;
      if (this.peak === STREAM_WARN_AT) this.warn(this.snapshot());
    }
    let closed = false;
    return () => {
      if (closed) return;
      closed = true;
      this.closed++;
    };
  }
}
