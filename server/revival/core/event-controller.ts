/**
 * Manages provider event transport lifecycle, bounded reconnect attempts, and terminal shutdown.
 * @module
 */
import type { DomainEvent } from './domain-event.ts';

type Scheduler = { schedule(delayMs: number, callback: () => void): number; cancel(id: number): void };
type Ingress = { enqueue(event: DomainEvent): { accepted: boolean; reason?: string } };
type Handlers = {
  onOpen: () => void;
  onMessage: (value: unknown) => void;
  onClose: (reason?: string) => void;
  onError: (error: unknown) => void;
};

/**
 * Transport adapter required by the controller.
 * connect(handlers) registers open/message/close/error callbacks for one transport
 * instance and returns no value. close() terminates that instance; the caller
 * ignores callbacks from replaced or terminal transports. Transport failures
 * may be reported through callbacks or thrown by the adapter.
 */
export interface EventTransport { connect(handlers: Handlers): void; close(): void; }
/**
 * Creates an event transport on initial connection and on reconnect.
 */
export type EventTransportFactory = () => EventTransport;
/**
 * Converts native transport messages into normalized domain events or ignores them.
 */
export type EventTranslator = (value: unknown) => DomainEvent | undefined;
type ControllerState = 'IDLE' | 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED' | 'RECONNECTING' | 'DEGRADED' | 'SHUTDOWN';

/**
 * Owns connection state and retries; stale transport callbacks cannot mutate a replacement connection.
 */
export class EventController {
  private readonly factory: EventTransportFactory;
  private readonly scheduler: Scheduler;
  private readonly ingress: Ingress;
  private readonly translate: EventTranslator;
  private readonly backoff: number[];
  private transport?: EventTransport;
  private retryId?: number;
  private attempt = 0;
  private terminal = false;
  private manualDisconnect = false;
  private value: ControllerState = 'IDLE';
  private lastReason?: string;

  /**
   * Wires transport, testable scheduler, bounded ingress, translator, and retry delays.
   * @param factory - Creates a new transport per connection attempt.
   * @param scheduler - Host scheduler for cancellation and backoff.
   * @param ingress - Normalized event admission boundary.
   * @param translate - Provider-owned native event normalizer.
   * @param backoff - Delay for each allowed reconnect attempt in milliseconds.
   */
  constructor(factory: EventTransportFactory, scheduler: Scheduler, ingress: Ingress, translate: EventTranslator, backoff: number[] = [100, 250, 500]) {
    this.factory = factory;
    this.scheduler = scheduler;
    this.ingress = ingress;
    this.translate = translate;
    this.backoff = backoff;
  }

  /**
   * Returns a snapshot of connection/retry/degradation state.
   * @returns Current state, attempts, last reason, and terminal flag.
   */
  state() { return { state: this.value, reconnectAttempts: this.attempt, reason: this.lastReason, terminal: this.terminal }; }

  /**
   * Starts or resumes transport; duplicate connections are ignored.
   * @returns Nothing.
   * @throws Error after terminal shutdown.
   */
  connect(): void {
    if (this.terminal) throw new Error('controller is shutdown');
    if (this.value === 'CONNECTING' || this.value === 'CONNECTED' || this.value === 'RECONNECTING') return;
    this.manualDisconnect = false;
    this.open(false);
  }

  /**
   * Closes the active transport and cancels retries without permanently closing the controller.
   * @returns Nothing.
   */
  disconnect(): void {
    if (this.terminal) return;
    this.manualDisconnect = true;
    if (this.retryId !== undefined) { this.scheduler.cancel(this.retryId); this.retryId = undefined; }
    this.transport?.close();
    this.transport = undefined;
    this.value = 'DISCONNECTED';
  }

  /**
   * Permanently disables reconnect and ignores future callbacks.
   * @returns Nothing; idempotent.
   */
  shutdown(): void {
    if (this.terminal) return;
    this.terminal = true;
    this.manualDisconnect = true;
    if (this.retryId !== undefined) { this.scheduler.cancel(this.retryId); this.retryId = undefined; }
    this.transport?.close();
    this.transport = undefined;
    this.value = 'SHUTDOWN';
  }

  /**
   * Binds callback handlers to the current transport instance to discard stale responses.
   * @param reconnect - Whether this is a backoff retry.
   * @returns Nothing.
   */
  private open(reconnect: boolean): void {
    if (this.terminal) return;
    this.value = reconnect ? 'RECONNECTING' : 'CONNECTING';
    const transport = this.factory();
    this.transport = transport;
    const token = transport;
    transport.connect({
      onOpen: () => {
        if (this.terminal || this.transport !== token) return;
        this.value = 'CONNECTED';
        this.attempt = 0;
        this.lastReason = undefined;
      },
      onMessage: (raw) => {
        if (this.terminal || this.transport !== token || this.value !== 'CONNECTED') return;
        const event = this.translate(raw);
        if (!event) return;
        const result = this.ingress.enqueue(event);
        if (!result.accepted && result.reason === 'BACKPRESSURE') {
          this.value = 'DEGRADED';
          this.lastReason = 'BACKPRESSURE';
        }
      },
      onClose: (reason) => {
        if (this.terminal || this.transport !== token) return;
        this.transport = undefined;
        this.lastReason = reason;
        if (this.manualDisconnect) { this.value = 'DISCONNECTED'; return; }
        this.scheduleReconnect();
      },
      onError: () => {
        if (this.terminal || this.transport !== token) return;
        this.lastReason = 'TRANSPORT_ERROR';
      }
    });
  }

  /**
   * Schedules the next bounded retry or records exhausted/degraded state.
   * @returns Nothing.
   */
  private scheduleReconnect(): void {
    if (this.terminal || this.manualDisconnect) return;
    if (this.attempt >= this.backoff.length) {
      this.value = 'DEGRADED';
      this.lastReason = 'RECONNECT_EXHAUSTED';
      return;
    }
    const delay = this.backoff[this.attempt];
    this.attempt++;
    this.value = 'RECONNECTING';
    this.retryId = this.scheduler.schedule(delay, () => {
      this.retryId = undefined;
      if (!this.terminal && !this.manualDisconnect) this.open(true);
    });
  }
}
