import type { DomainEvent } from './domain-event.ts';

type Scheduler = { schedule(delayMs: number, callback: () => void): number; cancel(id: number): void };
type Ingress = { enqueue(event: DomainEvent): { accepted: boolean; reason?: string } };
type Handlers = {
  onOpen: () => void;
  onMessage: (value: unknown) => void;
  onClose: (reason?: string) => void;
  onError: (error: unknown) => void;
};

export interface EventTransport { connect(handlers: Handlers): void; close(): void; }
export type EventTransportFactory = () => EventTransport;
export type EventTranslator = (value: unknown) => DomainEvent | undefined;
type ControllerState = 'IDLE' | 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED' | 'RECONNECTING' | 'DEGRADED' | 'SHUTDOWN';

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

  constructor(factory: EventTransportFactory, scheduler: Scheduler, ingress: Ingress, translate: EventTranslator, backoff: number[] = [100, 250, 500]) {
    this.factory = factory;
    this.scheduler = scheduler;
    this.ingress = ingress;
    this.translate = translate;
    this.backoff = backoff;
  }

  state() { return { state: this.value, reconnectAttempts: this.attempt, reason: this.lastReason, terminal: this.terminal }; }

  connect(): void {
    if (this.terminal) throw new Error('controller is shutdown');
    if (this.value === 'CONNECTING' || this.value === 'CONNECTED' || this.value === 'RECONNECTING') return;
    this.manualDisconnect = false;
    this.open(false);
  }

  disconnect(): void {
    if (this.terminal) return;
    this.manualDisconnect = true;
    if (this.retryId !== undefined) { this.scheduler.cancel(this.retryId); this.retryId = undefined; }
    this.transport?.close();
    this.transport = undefined;
    this.value = 'DISCONNECTED';
  }

  shutdown(): void {
    if (this.terminal) return;
    this.terminal = true;
    this.manualDisconnect = true;
    if (this.retryId !== undefined) { this.scheduler.cancel(this.retryId); this.retryId = undefined; }
    this.transport?.close();
    this.transport = undefined;
    this.value = 'SHUTDOWN';
  }

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
