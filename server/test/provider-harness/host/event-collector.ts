/**
 * Deterministic test event sink with terminal-close behavior.
 * @module
 */
/**
 * Stores typed test events without external side effects.
 */
class EventCollector<T = unknown> {
  private events: T[] = [];
  private closed = false;
  /**
   * Appends an event.
   * @param event - Incoming test event.
   * @returns Nothing.
   * @throws Error after close.
   */
  emit(event: T): void { if (this.closed) throw new Error('EventCollector is closed'); this.events.push(event); }
  /**
   * Reads a copy of the recorded events.
   * @returns Read-only event list.
   */
  all(): readonly T[] { return [...this.events]; }
  /**
   * Reads event count.
   * @returns Number of events.
   */
  count(): number { return this.events.length; }
  /**
   * Clears prior events.
   * @returns Nothing.
   */
  clear(): void { this.events = []; }
  /**
   * Prevents subsequent emissions.
   * @returns Nothing.
   */
  close(): void { this.closed = true; }
}
module.exports = { EventCollector };
