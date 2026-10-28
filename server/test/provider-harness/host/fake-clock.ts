class FakeClock {
  private currentMs: number;

  constructor(start: string | number | Date = 0) {
    this.currentMs = start instanceof Date ? start.getTime() : typeof start === 'string' ? Date.parse(start) : start;
    if (!Number.isFinite(this.currentMs)) throw new Error('FakeClock requires a valid start time');
  }

  now(): number { return this.currentMs; }
  date(): Date { return new Date(this.currentMs); }
  set(value: string | number | Date): void {
    const next = value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : value;
    if (!Number.isFinite(next)) throw new Error('FakeClock requires a valid time');
    if (next < this.currentMs) throw new Error('FakeClock cannot move backwards');
    this.currentMs = next;
  }
  advanceBy(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) throw new Error('advanceBy requires a non-negative finite duration');
    this.currentMs += ms;
  }
}
module.exports = { FakeClock };
