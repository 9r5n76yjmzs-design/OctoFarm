/**
 * Maintains bounded event queues, provider-instance-scoped replay retention, and isolated consumer delivery.
 * @module
 */
import { assertDomainEvent, replayKey, streamKey } from './domain-event.ts';
import type { DomainEvent } from './domain-event.ts';

type Scheduler = { schedule(delayMs: number, callback: () => void): number };
type Consumer = (event: DomainEvent) => void;

/**
 * Admission result distinguishing duplicates, backpressure, and closed ingress.
 */
export interface IngressResult {
  accepted: boolean;
  duplicate: boolean;
  degraded: boolean;
  reason?: 'DUPLICATE' | 'BACKPRESSURE' | 'CLOSED';
}

/**
 * Schedules FIFO delivery per stream while bounding both queue entries and replay memory.
 */
export class BoundedEventIngress {
  private readonly scheduler: Scheduler;
  private readonly consumer: Consumer;
  private readonly capacity: number;
  private readonly dedupeCapacity: number;
  private readonly queues = new Map<string, DomainEvent[]>();
  private readonly draining = new Set<string>();
  private readonly seen = new Set<string>();
  private readonly seenOrder: string[] = [];
  private seenCursor = 0;
  private queued = 0;
  private closed = false;
  private degraded = false;
  private failures = 0;

  /**
   * Configures bounded queues, a finite replay identity window, and deterministic delivery.
   * @param scheduler - Schedules per-stream drain callbacks.
   * @param consumer - Handles accepted events; exceptions are recorded, not rethrown.
   * @param capacity - Maximum queued event count across streams.
   * @param dedupeCapacity - Maximum retained replay identities.
   * @throws Error for non-positive or non-integer capacities.
   */
  constructor(
    scheduler: Scheduler,
    consumer: Consumer,
    capacity: number = 64,
    dedupeCapacity: number = Math.max(1024, capacity * 16)
  ) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error('capacity must be >= 1');
    if (!Number.isInteger(dedupeCapacity) || dedupeCapacity < 1) throw new Error('dedupeCapacity must be >= 1');
    this.scheduler = scheduler;
    this.consumer = consumer;
    this.capacity = capacity;
    this.dedupeCapacity = dedupeCapacity;
  }

  /**
   * Validates, deduplicates and queues an event without invoking consumers synchronously.
   * @param event - Runtime-validated domain event.
   * @returns Admission status and explicit refusal reason.
   * @throws Error when event violates its normalized schema.
   */
  enqueue(event: DomainEvent): IngressResult {
    if (this.closed) return { accepted: false, duplicate: false, degraded: this.degraded, reason: 'CLOSED' };
    assertDomainEvent(event);

    const identity = replayKey(event);
    if (this.seen.has(identity)) {
      return { accepted: false, duplicate: true, degraded: this.degraded, reason: 'DUPLICATE' };
    }
    if (this.queued >= this.capacity) {
      this.degraded = true;
      return { accepted: false, duplicate: false, degraded: true, reason: 'BACKPRESSURE' };
    }

    this.remember(identity);
    const key = streamKey(event);
    const queue = this.queues.get(key) ?? [];
    queue.push(event);
    this.queues.set(key, queue);
    this.queued++;

    if (!this.draining.has(key)) {
      this.draining.add(key);
      this.scheduler.schedule(0, () => this.drain(key));
    }
    return { accepted: true, duplicate: false, degraded: this.degraded };
  }

  /**
   * Reports queue load, replay retention, degradation, failures and closed state.
   * @returns Observability snapshot; no mutable internal collections.
   */
  status() {
    return {
      queued: this.queued,
      capacity: this.capacity,
      dedupeEntries: this.seen.size,
      dedupeCapacity: this.dedupeCapacity,
      degraded: this.degraded,
      consumerFailures: this.failures,
      closed: this.closed
    };
  }

  /**
   * Closes ingress and clears queues and replay-memory structures.
   * @returns Nothing; future events are refused.
   */
  close(): void {
    this.closed = true;
    this.queues.clear();
    this.draining.clear();
    this.seen.clear();
    this.seenOrder.length = 0;
    this.seenCursor = 0;
    this.queued = 0;
  }

  /**
   * Records one accepted replay identity, evicting oldest identities at capacity.
   * @param identity - Provider-instance-scoped replay key.
   * @returns Nothing.
   */
  private remember(identity: string): void {
    this.seen.add(identity);
    this.seenOrder.push(identity);

    while (this.seen.size > this.dedupeCapacity) {
      const oldest = this.seenOrder[this.seenCursor++];
      if (oldest !== undefined) this.seen.delete(oldest);
    }

    if (this.seenCursor > 1024 && this.seenCursor * 2 > this.seenOrder.length) {
      this.seenOrder.splice(0, this.seenCursor);
      this.seenCursor = 0;
    }
  }

  /**
   * Delivers one event to its consumer and isolates thrown consumer errors.
   * @param key - Provider/printer stream key.
   * @returns Nothing.
   */
  private drain(key: string): void {
    if (this.closed) {
      this.draining.delete(key);
      return;
    }

    const queue = this.queues.get(key);
    const event = queue?.shift();
    if (!event) {
      this.draining.delete(key);
      this.queues.delete(key);
      return;
    }

    this.queued--;
    try {
      this.consumer(event);
    } catch {
      this.degraded = true;
      this.failures++;
    }

    if (queue && queue.length > 0) this.scheduler.schedule(0, () => this.drain(key));
    else {
      this.draining.delete(key);
      this.queues.delete(key);
    }
  }
}
