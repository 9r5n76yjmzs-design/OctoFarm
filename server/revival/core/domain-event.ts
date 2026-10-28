export type DomainEventType =
  | 'ProviderConnected' | 'ProviderDisconnected' | 'ProviderHealthChanged' | 'CapabilitiesChanged'
  | 'PrinterConnectionChanged' | 'PrinterStateChanged'
  | 'PrintStarted' | 'PrintPaused' | 'PrintResumed' | 'PrintCancelled' | 'PrintCompleted' | 'PrintFailed';

export interface DomainEvent<T = unknown> {
  schemaVersion: 1;
  eventId: string;
  type: DomainEventType;
  printerId: string;
  providerId: string;
  providerInstanceId: string;
  occurredAt: number;
  observedAt: number;
  correlationId?: string;
  causationId?: string;
  payload: T;
}

const TYPES = new Set<DomainEventType>([
  'ProviderConnected','ProviderDisconnected','ProviderHealthChanged','CapabilitiesChanged',
  'PrinterConnectionChanged','PrinterStateChanged','PrintStarted','PrintPaused','PrintResumed',
  'PrintCancelled','PrintCompleted','PrintFailed'
]);

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid domain event: ${message}`);
}

export function assertDomainEvent<T>(event: DomainEvent<T>): DomainEvent<T> {
  invariant(event && typeof event === 'object', 'event must be an object');
  invariant(event.schemaVersion === 1, 'unsupported schemaVersion');
  invariant(typeof event.eventId === 'string' && event.eventId.length > 0, 'eventId is required');
  invariant(TYPES.has(event.type), `unsupported type ${String(event.type)}`);
  invariant(typeof event.printerId === 'string' && event.printerId.length > 0, 'printerId is required');
  invariant(typeof event.providerId === 'string' && event.providerId.length > 0, 'providerId is required');
  invariant(typeof event.providerInstanceId === 'string' && event.providerInstanceId.length > 0, 'providerInstanceId is required');
  invariant(Number.isFinite(event.occurredAt), 'occurredAt is required');
  invariant(Number.isFinite(event.observedAt), 'observedAt is required');
  return event;
}

export function streamKey(event: DomainEvent): string {
  return `${event.providerInstanceId}:${event.printerId}`;
}
