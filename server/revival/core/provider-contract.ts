/**
 * Canonical provider-neutral snapshot and runtime validation contract; native fields must not escape into core state.
 * @module
 */
/**
 * Supported normalized capability names, independent of the native printer API.
 */
export type CapabilityId =
  | 'PRINT'
  | 'PAUSE'
  | 'RESUME'
  | 'CANCEL'
  | 'RESTART'
  | 'FILE_LIST'
  | 'FILE_UPLOAD'
  | 'FILE_SELECT'
  | 'FILE_DELETE'
  | 'FILE_MOVE'
  | 'FILE_COPY'
  | 'STORAGE_LIST'
  | 'STORAGE_WRITE'
  | 'STORAGE_REMOVE'
  | 'STORAGE_REFRESH';

/**
 * Identifies provider implementation, running instance, protocol and versions separately.
 */
export interface ProviderIdentity {
  /** Stable provider implementation kind; shared by instances of that adapter. */
  providerId: string;
  /** Unique running provider instance, distinct from provider kind and printer ID. */
  providerInstanceId: string;
  /** Display label for a provider implementation. */
  displayName: string;
  /** Version reported by the underlying provider service. */
  providerVersion: string;
  /** Version identifier of this Revival adapter implementation. */
  implementationVersion: string;
  /** Optional normalized protocol family. */
  protocolFamily?: string;
  /** Optional negotiated native protocol version. */
  protocolVersion?: string;
}

/**
 * Declares supported behavior; availability is represented separately.
 */
export interface Capability {
  /** Provider-neutral operation being declared. */
  id: CapabilityId;
  /** Whether the adapter implements the operation; distinct from current availability. */
  supported: boolean;
  /** Optional version of this capability contract. */
  version?: string;
  /** Optional normalized capability limits; do not pass native objects through. */
  constraints?: Record<string, unknown>;
}

/**
 * Describes current ability to invoke a supported capability at a particular observation/revision.
 */
export interface OperationAvailability {
  /** Operation for which this observation applies. */
  capabilityId: CapabilityId;
  /** Whether the supported operation is currently invokable. */
  available: boolean;
  /** Optional normalized explanation when unavailable. */
  reason?: string;
  /** Timestamp associated with the availability observation. */
  observedAt: number;
  /** Capability revision against which this availability was computed. */
  capabilitiesRevision: number;
}

/**
 * Normalized link state; independent of current printer operation.
 */
export type ConnectionState =
  | 'UNKNOWN'
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'RECONNECTING'
  | 'FAILED';

/**
 * Normalized printer operation state; independent of provider transport health.
 */
export type OperationalState =
  | 'UNKNOWN'
  | 'IDLE'
  | 'PREPARING'
  | 'PRINTING'
  | 'PAUSED'
  | 'COMPLETING'
  | 'ERROR'
  | 'MAINTENANCE'
  | 'UNAVAILABLE';

/**
 * Authoritative normalized operational observation, including revision and timestamp.
 */
export interface PrinterState {
  /** Stable printer identity used for domain state reconciliation. */
  printerId: string;
  /** Normalized printer connection state, not a health substitute. */
  connection: ConnectionState;
  /** Current normalized printer operation. */
  operation: OperationalState;
  /** Revision applicable to this observation. */
  capabilitiesRevision: number;
  /** Observation time used to reject stale state. */
  observedAt: number;
}

/**
 * Provider reachability/authentication and transport health, distinct from printer state.
 */
export interface ProviderHealth {
  /** Whether the provider endpoint was reachable on the last observation. */
  reachable: boolean;
  /** Whether authentication succeeded on the last observation. */
  authenticated: boolean;
  /** Whether the provider transport is connected. */
  transportConnected: boolean;
  /** Optional observed latency in milliseconds. */
  latencyMs?: number;
  /** Optional timestamp of last successful contact. */
  lastSuccessfulContact?: number;
  /** Whether a provider retry is in progress. */
  retrying: boolean;
  /** Whether provider health is degraded. */
  degraded: boolean;
  /** Optional normalized diagnostic reason, not a raw provider exception. */
  reason?: string;
  /** Timestamp of this health observation. */
  observedAt: number;
}

/**
 * Provider-neutral connection reference, not a native port/connector object.
 */
export interface ConnectorRef {
  /** Stable logical connector identifier. */
  id: string;
  /** Normalized connector transport family. */
  family: 'SERIAL' | 'NETWORK' | 'OTHER' | 'UNKNOWN';
  /** Whether the connector is currently connected. */
  connected: boolean;
  /** Optional safe human-readable connector label. */
  displayName?: string;
  /** Optional normalized connector capability labels. */
  capabilities?: string[];
}

/**
 * Provider-neutral storage capabilities and writeability classification.
 */
export interface StorageRef {
  /** Logical storage identity, scoped to the provider. */
  id: string;
  /** Human-readable storage label. */
  name: string;
  /** Whether storage is on the printer rather than host. */
  printerSide: boolean;
  /** Whether the storage medium is removable. */
  removable: boolean;
  /** Whether storage is presently accessible. */
  available: boolean;
  /** Whether writes are supported and allowed by storage state. */
  writable: boolean;
  /** Supported storage-related operations for this reference. */
  capabilities: CapabilityId[];
}

/**
 * Provider-logical file identity; path MUST NOT be combined with local filesystem roots.
 */
export interface FileRef {
  /** Logical storage owning this file. */
  storageId: string;
  /** Safe provider-logical relative path, not a host filesystem path. */
  path: string;
  /** Base filename of the logical object. */
  name: string;
  /** Optional user-facing filename. */
  displayName?: string;
  /** Optional file size as reported by the provider, in bytes. */
  size?: number;
  /** Optional provider-reported modification timestamp. */
  modifiedAt?: number;
  /** Optional bounded, normalized metadata; never raw secret-bearing native fields. */
  metadata?: Record<string, unknown>;
}

/**
 * Single normalized boundary object validated before entering Revival core.
 */
export interface ProviderSnapshot {
  /** Provider and running-instance identity. */
  identity: ProviderIdentity;
  /** Authoritative capability generation used by snapshot and availability. */
  capabilitiesRevision: number;
  /** Operations supported by the provider. */
  capabilities: Capability[];
  /** Runtime availability for supported operations. */
  availability: OperationAvailability[];
  /** Normalized printer connection and operation observation. */
  state: PrinterState;
  /** Independent provider transport/authentication health observation. */
  health: ProviderHealth;
  /** Optional currently described connector. */
  connector?: ConnectorRef;
  /** Normalized available storage references. */
  storages: StorageRef[];
  /** Normalized provider-logical file references. */
  files: FileRef[];
}

/**
 * Enforces a runtime provider-contract invariant.
 * @param condition - Assertion condition.
 * @param message - Stable validation explanation.
 * @returns Nothing if valid.
 * @throws Error if validation fails.
 */
function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid normalized provider value: ${message}`);
}

/**
 * Rejects unknown fields in a normalized object.
 * @param value - Object to inspect.
 * @param allowed - Explicit list of permitted keys.
 * @param name - Diagnostic field prefix.
 * @returns Nothing on success.
 * @throws Error for non-object/extra properties.
 */
function assertOnlyKeys(
  value: unknown,
  allowed: readonly string[],
  name: string
): asserts value is Record<string, unknown> {
  invariant(value !== null && typeof value === 'object' && !Array.isArray(value), `${name} must be an object`);
  const allowedSet = new Set(allowed);
  const unexpected = Object.keys(value).filter((key) => !allowedSet.has(key));
  invariant(unexpected.length === 0, `${name} contains unexpected field(s): ${unexpected.join(', ')}`);
}

/**
 * Normalizes bounded encoding and separators while rejecting traversal and empty paths.
 * @param value - Provider-logical path, never a host filesystem path.
 * @returns Normalized relative path with forward slashes.
 * @throws Error for malformed/deep encoding, NUL, traversal, absolute/drive paths or empty result.
 */
export function normalizeLogicalPath(value: string): string {
  invariant(typeof value === 'string' && value.length > 0, 'file path must be non-empty');

  let decoded = value;
  let stable = false;
  for (let i = 0; i < 8; i++) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      invariant(false, 'file path contains invalid encoding');
    }
    if (next === decoded) {
      stable = true;
      break;
    }
    decoded = next;
  }

  invariant(stable, 'file path encoding exceeds normalization limit');
  invariant(!decoded.includes(String.fromCharCode(0)), 'file path must not contain NUL');

  const portable = decoded.replace(/\\/g, '/');
  invariant(
    !portable.startsWith('/') && !/^[A-Za-z]:\//.test(portable),
    'file path must be logical and relative'
  );

  const parts = portable.split('/').filter((part) => part !== '' && part !== '.');
  invariant(!parts.includes('..'), 'file path must not contain traversal');
  const normalized = parts.join('/');
  invariant(normalized.length > 0, 'file path must remain non-empty after normalization');
  return normalized;
}

const CAPABILITY_IDS = new Set<CapabilityId>([
  'PRINT','PAUSE','RESUME','CANCEL','RESTART',
  'FILE_LIST','FILE_UPLOAD','FILE_SELECT','FILE_DELETE','FILE_MOVE','FILE_COPY',
  'STORAGE_LIST','STORAGE_WRITE','STORAGE_REMOVE','STORAGE_REFRESH'
]);

const CONNECTION_STATES = new Set<ConnectionState>([
  'UNKNOWN','DISCONNECTED','CONNECTING','CONNECTED','RECONNECTING','FAILED'
]);

const OPERATIONAL_STATES = new Set<OperationalState>([
  'UNKNOWN','IDLE','PREPARING','PRINTING','PAUSED','COMPLETING','ERROR','MAINTENANCE','UNAVAILABLE'
]);

const CONNECTOR_FAMILIES = new Set<ConnectorRef['family']>([
  'SERIAL','NETWORK','OTHER','UNKNOWN'
]);

/**
 * Validates required normalized string fields.
 * @param value - Unknown value.
 * @param name - Field label.
 * @returns Nothing when valid.
 * @throws Error on empty/non-string data.
 */
function nonEmptyString(value: unknown, name: string): asserts value is string {
  invariant(typeof value === 'string' && value.length > 0, `${name} must be a non-empty string`);
}

/**
 * Validates optional string fields without coercion.
 * @param value - Optional field.
 * @param name - Field label.
 * @returns Nothing on success.
 * @throws Error on non-string values.
 */
function optionalString(value: unknown, name: string): void {
  if (value !== undefined) nonEmptyString(value, name);
}

/**
 * Requires a finite number in normalized data.
 * @param value - Unknown value.
 * @param name - Field label.
 * @returns Nothing on success.
 * @throws Error on non-numeric/NaN/Infinity values.
 */
function finiteNumber(value: unknown, name: string): asserts value is number {
  invariant(typeof value === 'number' && Number.isFinite(value), `${name} must be finite`);
}

/**
 * Validates optional records for a normalized boundary.
 * @param value - Optional record.
 * @param name - Field label.
 * @returns Nothing on success.
 * @throws Error for non-object/array data.
 */
function optionalRecord(value: unknown, name: string): void {
  if (value === undefined) return;
  invariant(value !== null && typeof value === 'object' && !Array.isArray(value), `${name} must be an object`);
}

/**
 * Enforces allowed fields and semantic values across snapshot, identity, health, capabilities, connector, storage, and files.
 * @param value - Provider-produced snapshot candidate.
 * @returns Original snapshot when all nested shapes validate.
 * @throws Error for native/undeclared fields, invalid enum/number/boolean semantics or unsafe FileRef paths.
 */
export function assertProviderSnapshot(value: ProviderSnapshot): ProviderSnapshot {
  assertOnlyKeys(value, [
    'identity','capabilitiesRevision','capabilities','availability','state','health','connector','storages','files'
  ], 'snapshot');
  assertOnlyKeys(value.identity, [
    'providerId','providerInstanceId','displayName','providerVersion','implementationVersion','protocolFamily','protocolVersion'
  ], 'identity');
  assertOnlyKeys(value.state, [
    'printerId','connection','operation','capabilitiesRevision','observedAt'
  ], 'state');
  assertOnlyKeys(value.health, [
    'reachable','authenticated','transportConnected','latencyMs','lastSuccessfulContact','retrying','degraded','reason','observedAt'
  ], 'health');

  nonEmptyString(value.identity.providerId, 'identity.providerId');
  nonEmptyString(value.identity.providerInstanceId, 'identity.providerInstanceId');
  nonEmptyString(value.identity.displayName, 'identity.displayName');
  nonEmptyString(value.identity.providerVersion, 'identity.providerVersion');
  nonEmptyString(value.identity.implementationVersion, 'identity.implementationVersion');
  optionalString(value.identity.protocolFamily, 'identity.protocolFamily');
  optionalString(value.identity.protocolVersion, 'identity.protocolVersion');

  invariant(Number.isInteger(value.capabilitiesRevision) && value.capabilitiesRevision >= 1, 'capabilitiesRevision must be >= 1');
  invariant(Array.isArray(value.capabilities), 'capabilities must be an array');
  invariant(Array.isArray(value.availability), 'availability must be an array');
  invariant(Array.isArray(value.storages), 'storages must be an array');
  invariant(Array.isArray(value.files), 'files must be an array');

  nonEmptyString(value.state.printerId, 'state.printerId');
  invariant(CONNECTION_STATES.has(value.state.connection), 'state.connection must be normalized');
  invariant(OPERATIONAL_STATES.has(value.state.operation), 'state.operation must be normalized');
  invariant(
    Number.isInteger(value.state.capabilitiesRevision) &&
    value.state.capabilitiesRevision === value.capabilitiesRevision,
    'state capabilitiesRevision mismatch'
  );
  finiteNumber(value.state.observedAt, 'state.observedAt');

  invariant(typeof value.health.reachable === 'boolean', 'health.reachable is required');
  invariant(typeof value.health.authenticated === 'boolean', 'health.authenticated is required');
  invariant(typeof value.health.transportConnected === 'boolean', 'health.transportConnected is required');
  invariant(typeof value.health.retrying === 'boolean', 'health.retrying is required');
  invariant(typeof value.health.degraded === 'boolean', 'health.degraded is required');
  if (value.health.latencyMs !== undefined) {
    finiteNumber(value.health.latencyMs, 'health.latencyMs');
    invariant(value.health.latencyMs >= 0, 'health.latencyMs must be non-negative');
  }
  if (value.health.lastSuccessfulContact !== undefined) {
    finiteNumber(value.health.lastSuccessfulContact, 'health.lastSuccessfulContact');
  }
  optionalString(value.health.reason, 'health.reason');
  finiteNumber(value.health.observedAt, 'health.observedAt');

  if (value.connector !== undefined) {
    assertOnlyKeys(value.connector, ['id','family','connected','displayName','capabilities'], 'connector');
    nonEmptyString(value.connector.id, 'connector.id');
    invariant(CONNECTOR_FAMILIES.has(value.connector.family), 'connector.family must be normalized');
    invariant(typeof value.connector.connected === 'boolean', 'connector.connected is required');
    optionalString(value.connector.displayName, 'connector.displayName');
    if (value.connector.capabilities !== undefined) {
      invariant(Array.isArray(value.connector.capabilities), 'connector.capabilities must be an array');
      for (const item of value.connector.capabilities) nonEmptyString(item, 'connector.capability');
    }
  }

  for (const capability of value.capabilities) {
    assertOnlyKeys(capability, ['id','supported','version','constraints'], 'capability');
    invariant(CAPABILITY_IDS.has(capability.id), 'capability.id must be normalized');
    invariant(typeof capability.supported === 'boolean', 'capability.supported is required');
    optionalString(capability.version, 'capability.version');
    optionalRecord(capability.constraints, 'capability.constraints');
  }

  for (const availability of value.availability) {
    assertOnlyKeys(availability, ['capabilityId','available','reason','observedAt','capabilitiesRevision'], 'availability');
    invariant(CAPABILITY_IDS.has(availability.capabilityId), 'availability.capabilityId must be normalized');
    invariant(typeof availability.available === 'boolean', 'availability.available is required');
    optionalString(availability.reason, 'availability.reason');
    finiteNumber(availability.observedAt, 'availability.observedAt');
    invariant(
      Number.isInteger(availability.capabilitiesRevision) &&
      availability.capabilitiesRevision === value.capabilitiesRevision,
      'availability revision mismatch'
    );
  }

  for (const storage of value.storages) {
    assertOnlyKeys(storage, ['id','name','printerSide','removable','available','writable','capabilities'], 'storage');
    nonEmptyString(storage.id, 'storage.id');
    nonEmptyString(storage.name, 'storage.name');
    invariant(typeof storage.printerSide === 'boolean', 'storage.printerSide is required');
    invariant(typeof storage.removable === 'boolean', 'storage.removable is required');
    invariant(typeof storage.available === 'boolean', 'storage.available is required');
    invariant(typeof storage.writable === 'boolean', 'storage.writable is required');
    invariant(Array.isArray(storage.capabilities), 'storage.capabilities must be an array');
    for (const id of storage.capabilities) invariant(CAPABILITY_IDS.has(id), 'storage capability must be normalized');
  }

  for (const file of value.files) {
    assertOnlyKeys(file, ['storageId','path','name','displayName','size','modifiedAt','metadata'], 'file');
    nonEmptyString(file.storageId, 'file.storageId');
    nonEmptyString(file.path, 'file.path');
    nonEmptyString(file.name, 'file.name');
    optionalString(file.displayName, 'file.displayName');
    if (file.size !== undefined) {
      finiteNumber(file.size, 'file.size');
      invariant(file.size >= 0, 'file.size must be non-negative');
    }
    if (file.modifiedAt !== undefined) finiteNumber(file.modifiedAt, 'file.modifiedAt');
    optionalRecord(file.metadata, 'file.metadata');
  }

  const supported = new Set(value.capabilities.filter((c) => c.supported).map((c) => c.id));
  for (const availability of value.availability) {
    invariant(supported.has(availability.capabilityId), `availability declared for unsupported ${availability.capabilityId}`);
  }
  for (const file of value.files) {
    invariant(value.storages.some((storage) => storage.id === file.storageId), `unknown storage ${file.storageId}`);
    invariant(normalizeLogicalPath(file.path) === file.path, `non-normalized file path ${file.path}`);
  }
  return value;
}
