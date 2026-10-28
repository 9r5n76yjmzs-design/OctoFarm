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

export function normalizeLogicalPath(value: string): string {
  invariant(typeof value === 'string' && value.length > 0, 'file path must be non-empty');
  invariant(!value.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(value), 'file path must be logical and relative');
  const portable = value.replace(/\\/g, '/');
  const parts = portable.split('/').filter((part) => part !== '' && part !== '.');
  invariant(!parts.includes('..'), 'file path must not contain traversal');
  return parts.join('/');
}

export function assertProviderSnapshot(value: ProviderSnapshot): ProviderSnapshot {
  invariant(value && typeof value === 'object', 'snapshot must be an object');
  invariant(value.identity?.providerId?.length > 0, 'providerId is required');
  invariant(value.identity?.providerInstanceId?.length > 0, 'providerInstanceId is required');
  invariant(Number.isInteger(value.capabilitiesRevision) && value.capabilitiesRevision >= 1, 'capabilitiesRevision must be >= 1');
  invariant(Array.isArray(value.capabilities), 'capabilities must be an array');
  invariant(Array.isArray(value.availability), 'availability must be an array');
  invariant(Array.isArray(value.storages), 'storages must be an array');
  invariant(Array.isArray(value.files), 'files must be an array');
  invariant(value.state?.printerId?.length > 0, 'state.printerId is required');
  invariant(typeof value.health?.reachable === 'boolean', 'health.reachable is required');

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
