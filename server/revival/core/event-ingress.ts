import { assertDomainEvent, streamKey } from './domain-event.ts';
import type { DomainEvent } from './domain-event.ts';

type Scheduler = { schedule(delayMs: number, callback: () => void): number };
type Consumer = (event: DomainEvent) => void;

export interface IngressResult {
  accepted: boolean;
  duplicate: boolean;
  degraded: boolean;
  reason?: 'DUPLICATE' | 'BACKPRESSURE' | 'CLOSED';
}

export class BoundedEventIngress {
  private readonly scheduler: Scheduler;
  private readonly consumer: Consumer;
  private readonly capacity: number;
  private readonly queues = new Map<string, DomainEvent[]>();
  private readonly draining = new Set<string>();
  private readonly seen = new Set<string>();
  private queued = 0;
  private closed = false;
  private degraded = false;
  private failures = 0;

  constructor(scheduler: Scheduler, consumer: Consumer, capacity: number = 64) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error('capacity must be >= 1');
    this.scheduler = scheduler;
    this.consumer = consumer;
    this.capacity = capacity;
  }

  enqueue(event: DomainEvent): IngressResult {
    if (this.closed) return { accepted: false, duplicate: false, degraded: this.degraded, reason: 'CLOSED' };
    assertDomainEvent(event);
    if (this.seen.has(event.eventId)) {
      return { accepted: false, duplicate: true, degraded: this.degraded, reason: 'DUPLICATE' };
    }
    if (this.queued >= this.capacity) {
      this.degraded = true;
      return { accepted: false, duplicate: false, degraded: true, reason: 'BACKPRESSURE' };
    }
    this.seen.add(event.eventId);
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

  status() {
    return { queued: this.queued, capacity: this.capacity, degraded: this.degraded, consumerFailures: this.failures, closed: this.closed };
  }

  close(): void {
    this.closed = true;
    this.queues.clear();
    this.draining.clear();
    this.queued = 0;
  }

  private drain(key: string): void {
    if (this.closed) { this.draining.delete(key); return; }
    const queue = this.queues.get(key);
    const event = queue?.shift();
    if (!event) { this.draining.delete(key); this.queues.delete(key); return; }
    this.queued--;
    try { this.consumer(event); } catch { this.degraded = true; this.failures++; }
    if (queue && queue.length > 0) this.scheduler.schedule(0, () => this.drain(key));
    else { this.draining.delete(key); this.queues.delete(key); }
  }
}
