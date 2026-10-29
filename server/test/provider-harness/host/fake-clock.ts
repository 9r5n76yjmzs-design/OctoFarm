/**
 * Test clock driven by explicit changes rather than wall-clock waiting.
 * @module
 */
/**
 * Holds a mutable deterministic timestamp.
 */
class FakeClock {
  private currentMs: number;

  /**
   * Initializes fake time.
   * @param start - Epoch milliseconds, date string or Date.
   */
  constructor(start: string | number | Date = 0) {
    this.currentMs = start instanceof Date ? start.getTime() : typeof start === 'string' ? Date.parse(start) : start;
    if (!Number.isFinite(this.currentMs)) throw new Error('FakeClock requires a valid start time');
  }

  /**
   * Reads current test time.
   * @returns Epoch milliseconds.
   */
  now(): number { return this.currentMs; }
  /**
   * Converts fake time to a Date.
   * @returns New Date.
   */
  date(): Date { return new Date(this.currentMs); }
  /**
   * Sets test time to an instant.
   * @param value - Date-compatible input.
   * @returns Nothing.
   * @throws Error for invalid time.
   */
  set(value: string | number | Date): void {
    const next = value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : value;
    if (!Number.isFinite(next)) throw new Error('FakeClock requires a valid time');
    if (next < this.currentMs) throw new Error('FakeClock cannot move backwards');
    this.currentMs = next;
  }
  /**
   * Advances fake time.
   * @param ms - Millisecond delta.
   * @returns Nothing.
   * @throws Error for invalid delta.
   */
  advanceBy(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) throw new Error('advanceBy requires a non-negative finite duration');
    this.currentMs += ms;
  }
}
module.exports = { FakeClock };
