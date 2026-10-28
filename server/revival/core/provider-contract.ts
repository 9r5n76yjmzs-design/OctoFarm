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

export interface ProviderIdentity {
  providerId: string;
  providerInstanceId: string;
  displayName: string;
  providerVersion: string;
  implementationVersion: string;
  protocolFamily?: string;
  protocolVersion?: string;
}

export interface Capability {
  id: CapabilityId;
  supported: boolean;
  version?: string;
  constraints?: Record<string, unknown>;
}

export interface OperationAvailability {
  capabilityId: CapabilityId;
  available: boolean;
  reason?: string;
  observedAt: number;
  capabilitiesRevision: number;
}

export type ConnectionState =
  | 'UNKNOWN'
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'RECONNECTING'
  | 'FAILED';

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

export interface PrinterState {
  printerId: string;
  connection: ConnectionState;
  operation: OperationalState;
  capabilitiesRevision: number;
  observedAt: number;
}

export interface ProviderHealth {
  reachable: boolean;
  authenticated: boolean;
  transportConnected: boolean;
  latencyMs?: number;
  lastSuccessfulContact?: number;
  retrying: boolean;
  degraded: boolean;
  reason?: string;
  observedAt: number;
}

export interface ConnectorRef {
  id: string;
  family: 'SERIAL' | 'NETWORK' | 'OTHER' | 'UNKNOWN';
  connected: boolean;
  displayName?: string;
  capabilities?: string[];
}

export interface StorageRef {
  id: string;
  name: string;
  printerSide: boolean;
  removable: boolean;
  available: boolean;
  writable: boolean;
  capabilities: CapabilityId[];
}

export interface FileRef {
  storageId: string;
  path: string;
  name: string;
  displayName?: string;
  size?: number;
  modifiedAt?: number;
  metadata?: Record<string, unknown>;
}

export interface ProviderSnapshot {
  identity: ProviderIdentity;
  capabilitiesRevision: number;
  capabilities: Capability[];
  availability: OperationAvailability[];
  state: PrinterState;
  health: ProviderHealth;
  connector?: ConnectorRef;
  storages: StorageRef[];
  files: FileRef[];
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid normalized provider value: ${message}`);
}

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

export function assertProviderSnapshot(value: ProviderSnapshot): ProviderSnapshot {
  assertOnlyKeys(value, [
    'identity',
    'capabilitiesRevision',
    'capabilities',
    'availability',
    'state',
    'health',
    'connector',
    'storages',
    'files'
  ], 'snapshot');
  assertOnlyKeys(value.identity, [
    'providerId',
    'providerInstanceId',
    'displayName',
    'providerVersion',
    'implementationVersion',
    'protocolFamily',
    'protocolVersion'
  ], 'identity');
  assertOnlyKeys(value.state, [
    'printerId',
    'connection',
    'operation',
    'capabilitiesRevision',
    'observedAt'
  ], 'state');
  assertOnlyKeys(value.health, [
    'reachable',
    'authenticated',
    'transportConnected',
    'latencyMs',
    'lastSuccessfulContact',
    'retrying',
    'degraded',
    'reason',
    'observedAt'
  ], 'health');
  if (value.connector !== undefined) {
    assertOnlyKeys(value.connector, [
      'id',
      'family',
      'connected',
      'displayName',
      'capabilities'
    ], 'connector');
  }

  invariant(value.identity?.providerId?.length > 0, 'providerId is required');
  invariant(value.identity?.providerInstanceId?.length > 0, 'providerInstanceId is required');
  invariant(Number.isInteger(value.capabilitiesRevision) && value.capabilitiesRevision >= 1, 'capabilitiesRevision must be >= 1');
  invariant(Array.isArray(value.capabilities), 'capabilities must be an array');
  invariant(Array.isArray(value.availability), 'availability must be an array');
  invariant(Array.isArray(value.storages), 'storages must be an array');
  invariant(Array.isArray(value.files), 'files must be an array');
  invariant(value.state?.printerId?.length > 0, 'state.printerId is required');
  invariant(typeof value.health?.reachable === 'boolean', 'health.reachable is required');

  for (const capability of value.capabilities) {
    assertOnlyKeys(capability, ['id', 'supported', 'version', 'constraints'], 'capability');
  }
  for (const availability of value.availability) {
    assertOnlyKeys(availability, [
      'capabilityId',
      'available',
      'reason',
      'observedAt',
      'capabilitiesRevision'
    ], 'availability');
  }
  for (const storage of value.storages) {
    assertOnlyKeys(storage, [
      'id',
      'name',
      'printerSide',
      'removable',
      'available',
      'writable',
      'capabilities'
    ], 'storage');
  }
  for (const file of value.files) {
    assertOnlyKeys(file, [
      'storageId',
      'path',
      'name',
      'displayName',
      'size',
      'modifiedAt',
      'metadata'
    ], 'file');
  }

  const supported = new Set(value.capabilities.filter((c) => c.supported).map((c) => c.id));
  for (const availability of value.availability) {
    invariant(supported.has(availability.capabilityId), `availability declared for unsupported ${availability.capabilityId}`);
    invariant(availability.capabilitiesRevision === value.capabilitiesRevision, 'availability revision mismatch');
  }
  for (const file of value.files) {
    invariant(value.storages.some((storage) => storage.id === file.storageId), `unknown storage ${file.storageId}`);
    invariant(normalizeLogicalPath(file.path) === file.path, `non-normalized file path ${file.path}`);
  }
  return value;
}
