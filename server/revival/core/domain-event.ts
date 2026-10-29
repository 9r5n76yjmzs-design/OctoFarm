/**
 * Defines the normalized event envelope and rejects unrecognized event/payload shapes at the provider boundary.
 * @module
 */
import type { ConnectionState, OperationalState, PrinterState, ProviderHealth } from './provider-contract.ts';

/**
 * Supported normalized event classes; provider-native event names are not valid values.
 */
export type DomainEventType =
  | 'ProviderConnected' | 'ProviderDisconnected' | 'ProviderHealthChanged' | 'CapabilitiesChanged'
  | 'PrinterConnectionChanged' | 'PrinterStateChanged'
  | 'PrintStarted' | 'PrintPaused' | 'PrintResumed' | 'PrintCancelled' | 'PrintCompleted' | 'PrintFailed';

/**
 * Versioned, identity-scoped event contract delivered to the domain ingress.
 */
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

/**
 * Throws when a required normalized event invariant is not satisfied.
 * @param condition - Validation predicate.
 * @param message - Stable validation failure message.
 * @returns Nothing when valid.
 * @throws Error for invalid event data.
 */
function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid domain event: ${message}`);
}

/**
 * Requires an ordinary object for a nested event payload.
 * @param value - Unknown payload.
 * @param name - Field label for diagnostics.
 * @returns Validated record.
 * @throws Error for null, arrays, or non-objects.
 */
function object(value: unknown, name: string): Record<string, unknown> {
  invariant(value !== null && typeof value === 'object' && !Array.isArray(value), `${name} must be an object`);
  return value as Record<string, unknown>;
}

/**
 * Rejects undeclared fields at a normalized event payload boundary.
 * @param value - Candidate record.
 * @param allowed - Schema-approved field names.
 * @param name - Field label.
 * @returns Nothing when keys are valid.
 * @throws Error for extra fields.
 */
function exactKeys(value: Record<string, unknown>, allowed: readonly string[], name: string): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) invariant(allowedSet.has(key), `${name} contains unsupported field ${key}`);
}

/**
 * Validates optional bounded identity fields.
 * @param value - Optional identity value.
 * @param name - Field label.
 * @returns Nothing on success.
 * @throws Error for malformed or oversized IDs.
 */
function optionalId(value: unknown, name: string): void {
  if (value === undefined) return;
  invariant(typeof value === 'string' && value.length > 0 && value.length <= 256, `${name} must be a bounded string`);
}

/**
 * Checks printer state payload fields, enums, and revision/timestamp semantics.
 * @param value - Unknown state payload.
 * @returns Nothing on success.
 * @throws Error for invalid normalized state.
 */
function validatePrinterState(value: unknown): void {
  const state = object(value, 'payload.state');
  exactKeys(state, ['printerId','connection','operation','capabilitiesRevision','observedAt'], 'payload.state');
  invariant(typeof state.printerId === 'string' && state.printerId.length > 0, 'payload.state.printerId is required');
  invariant(CONNECTIONS.has(state.connection as ConnectionState), 'payload.state.connection is invalid');
  invariant(OPERATIONS.has(state.operation as OperationalState), 'payload.state.operation is invalid');
  invariant(Number.isInteger(state.capabilitiesRevision) && Number(state.capabilitiesRevision) >= 1, 'payload.state.capabilitiesRevision is invalid');
  invariant(Number.isFinite(state.observedAt), 'payload.state.observedAt is invalid');
}

/**
 * Validates provider health payload without accepting undeclared fields.
 * @param value - Unknown health payload.
 * @returns Nothing on success.
 * @throws Error for invalid health values.
 */
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

/**
 * Dispatches type-specific payload validation and enforces printer identity consistency.
 * @param event - Validated event envelope candidate.
 * @returns Nothing on success.
 * @throws Error for unsupported or malformed payloads.
 */
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

/**
 * Checks the full runtime normalized event boundary, including typed payloads.
 * @param event - Event supplied by a provider or translation layer.
 * @returns The original event for downstream use.
 * @throws Error for unsupported versions, invalid identities, payloads, or timestamps.
 */
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

/**
 * Builds the provider-instance/printer key used for ordered ingress.
 * @param event - Normalized event envelope.
 * @returns Per-stream identity key.
 */
export function streamKey(event: DomainEvent): string {
  return `${event.providerInstanceId}:${event.printerId}`;
}

/**
 * Scopes replay suppression by provider instance as well as native event ID.
 * @param event - Normalized event envelope.
 * @returns Replay suppression key.
 */
export function replayKey(event: DomainEvent): string {
  return `${event.providerInstanceId}\u0000${event.eventId}`;
}
