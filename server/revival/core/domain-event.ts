import type { ConnectionState, OperationalState, PrinterState, ProviderHealth } from './provider-contract.ts';

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

const CONNECTIONS = new Set<ConnectionState>([
  'UNKNOWN','DISCONNECTED','CONNECTING','CONNECTED','RECONNECTING','FAILED'
]);

const OPERATIONS = new Set<OperationalState>([
  'UNKNOWN','IDLE','PREPARING','PRINTING','PAUSED','COMPLETING','ERROR','MAINTENANCE','UNAVAILABLE'
]);

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid domain event: ${message}`);
}

function object(value: unknown, name: string): Record<string, unknown> {
  invariant(value !== null && typeof value === 'object' && !Array.isArray(value), `${name} must be an object`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], name: string): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) invariant(allowedSet.has(key), `${name} contains unsupported field ${key}`);
}

function optionalId(value: unknown, name: string): void {
  if (value === undefined) return;
  invariant(typeof value === 'string' && value.length > 0 && value.length <= 256, `${name} must be a bounded string`);
}

function validatePrinterState(value: unknown): void {
  const state = object(value, 'payload.state');
  exactKeys(state, ['printerId','connection','operation','capabilitiesRevision','observedAt'], 'payload.state');
  invariant(typeof state.printerId === 'string' && state.printerId.length > 0, 'payload.state.printerId is required');
  invariant(CONNECTIONS.has(state.connection as ConnectionState), 'payload.state.connection is invalid');
  invariant(OPERATIONS.has(state.operation as OperationalState), 'payload.state.operation is invalid');
  invariant(Number.isInteger(state.capabilitiesRevision) && Number(state.capabilitiesRevision) >= 1, 'payload.state.capabilitiesRevision is invalid');
  invariant(Number.isFinite(state.observedAt), 'payload.state.observedAt is invalid');
}

function validateHealth(value: unknown): void {
  const health = object(value, 'payload.health');
  exactKeys(
    health,
    ['reachable','authenticated','transportConnected','latencyMs','lastSuccessfulContact','retrying','degraded','reason','observedAt'],
    'payload.health'
  );
  for (const key of ['reachable','authenticated','transportConnected','retrying','degraded']) {
    invariant(typeof health[key] === 'boolean', `payload.health.${key} is required`);
  }
  if (health.latencyMs !== undefined) invariant(Number.isFinite(health.latencyMs), 'payload.health.latencyMs is invalid');
  if (health.lastSuccessfulContact !== undefined) invariant(Number.isFinite(health.lastSuccessfulContact), 'payload.health.lastSuccessfulContact is invalid');
  if (health.reason !== undefined) invariant(typeof health.reason === 'string' && health.reason.length <= 128, 'payload.health.reason is invalid');
  invariant(Number.isFinite(health.observedAt), 'payload.health.observedAt is invalid');
}

function validatePayload(event: DomainEvent): void {
  const payload = object(event.payload, 'payload');

  switch (event.type) {
    case 'ProviderConnected':
      exactKeys(payload, [], 'payload');
      return;
    case 'ProviderDisconnected':
      exactKeys(payload, ['reason'], 'payload');
      if (payload.reason !== undefined) invariant(typeof payload.reason === 'string' && payload.reason.length <= 128, 'payload.reason is invalid');
      return;
    case 'ProviderHealthChanged':
      exactKeys(payload, ['health'], 'payload');
      validateHealth(payload.health as ProviderHealth);
      return;
    case 'CapabilitiesChanged':
      exactKeys(payload, ['capabilitiesRevision'], 'payload');
      invariant(Number.isInteger(payload.capabilitiesRevision) && Number(payload.capabilitiesRevision) >= 1, 'payload.capabilitiesRevision is invalid');
      return;
    case 'PrinterConnectionChanged':
      exactKeys(payload, ['connection'], 'payload');
      invariant(CONNECTIONS.has(payload.connection as ConnectionState), 'payload.connection is invalid');
      return;
    case 'PrinterStateChanged':
      exactKeys(payload, ['state'], 'payload');
      validatePrinterState(payload.state as PrinterState);
      invariant((payload.state as PrinterState).printerId === event.printerId, 'payload.state.printerId must match event printerId');
      return;
    case 'PrintStarted':
    case 'PrintPaused':
    case 'PrintResumed':
    case 'PrintCancelled':
    case 'PrintFailed':
      exactKeys(payload, ['jobId'], 'payload');
      optionalId(payload.jobId, 'payload.jobId');
      return;
    case 'PrintCompleted':
      exactKeys(payload, ['jobId','completedAt'], 'payload');
      optionalId(payload.jobId, 'payload.jobId');
      if (payload.completedAt !== undefined) invariant(Number.isFinite(payload.completedAt), 'payload.completedAt is invalid');
      return;
  }
}

export function assertDomainEvent<T>(event: DomainEvent<T>): DomainEvent<T> {
  invariant(event && typeof event === 'object', 'event must be an object');
  invariant(event.schemaVersion === 1, 'unsupported schemaVersion');
  invariant(typeof event.eventId === 'string' && event.eventId.length > 0 && event.eventId.length <= 512, 'eventId is required and bounded');
  invariant(TYPES.has(event.type), `unsupported type ${String(event.type)}`);
  invariant(typeof event.printerId === 'string' && event.printerId.length > 0 && event.printerId.length <= 256, 'printerId is required and bounded');
  invariant(typeof event.providerId === 'string' && event.providerId.length > 0 && event.providerId.length <= 128, 'providerId is required and bounded');
  invariant(typeof event.providerInstanceId === 'string' && event.providerInstanceId.length > 0 && event.providerInstanceId.length <= 256, 'providerInstanceId is required and bounded');
  optionalId(event.correlationId, 'correlationId');
  optionalId(event.causationId, 'causationId');
  invariant(Number.isFinite(event.occurredAt), 'occurredAt is required');
  invariant(Number.isFinite(event.observedAt), 'observedAt is required');
  validatePayload(event as DomainEvent);
  return event;
}

export function streamKey(event: DomainEvent): string {
  return `${event.providerInstanceId}:${event.printerId}`;
}

export function replayKey(event: DomainEvent): string {
  return `${event.providerInstanceId}\u0000${event.eventId}`;
}
