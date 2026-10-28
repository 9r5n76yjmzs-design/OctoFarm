class EventCollector<T = unknown> {
  private events: T[] = [];
  private closed = false;
  emit(event: T): void { if (this.closed) throw new Error('EventCollector is closed'); this.events.push(event); }
  all(): readonly T[] { return [...this.events]; }
  count(): number { return this.events.length; }
  clear(): void { this.events = []; }
  close(): void { this.closed = true; }
}
module.exports = { EventCollector };
