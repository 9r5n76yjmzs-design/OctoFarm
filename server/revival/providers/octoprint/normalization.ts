import { normalizeLogicalPath } from '../../core/provider-contract.ts';
import type {
  Capability,
  CapabilityId,
  ConnectorRef,
  FileRef,
  OperationAvailability,
  OperationalState,
  PrinterState,
  StorageRef
} from '../../core/provider-contract.ts';

export type OctoPrintApiMode = 'LEGACY_1_X' | 'V2_COMPAT' | 'V2_NATIVE';

export interface NegotiatedOctoPrintIdentity {
  mode: OctoPrintApiMode;
  serverVersion: string;
  protocolVersion: string;
}

export function negotiateIdentity(
  initial: Record<string, unknown>,
  nativeProbe?: Record<string, unknown>
): NegotiatedOctoPrintIdentity {
  const serverVersion = String(initial.server ?? nativeProbe?.server ?? 'unknown');
  const major = Number.parseInt(serverVersion.split('.')[0] ?? '0', 10);
  if (!Number.isFinite(major) || major < 2) {
    return { mode: 'LEGACY_1_X', serverVersion, protocolVersion: String(initial.api ?? 'legacy') };
  }

  if (nativeProbe && !Object.prototype.hasOwnProperty.call(nativeProbe, 'api')) {
    return { mode: 'V2_NATIVE', serverVersion: String(nativeProbe.server ?? serverVersion), protocolVersion: '2.0.0' };
  }

  return { mode: 'V2_COMPAT', serverVersion, protocolVersion: String(nativeProbe?.api ?? initial.api ?? 'compat') };
}

function connectorFamily(type: unknown): ConnectorRef['family'] {
  const normalized = String(type ?? '').toLowerCase();
  if (normalized.includes('serial')) return 'SERIAL';
  if (normalized.includes('network') || normalized.includes('tcp') || normalized.includes('socket')) return 'NETWORK';
  if (normalized.length > 0) return 'OTHER';
  return 'UNKNOWN';
}

export function normalizeConnector(connection: Record<string, unknown>): ConnectorRef | undefined {
  const current = connection.current as Record<string, unknown> | undefined;
  if (!current) return undefined;

  const nativeConnector = current.connector as Record<string, unknown> | undefined;
  if (nativeConnector) {
    return {
      id: String(nativeConnector.id ?? 'connector'),
      family: connectorFamily(nativeConnector.type),
      connected: String(current.state ?? '').toLowerCase() !== 'closed',
      capabilities: Array.isArray(nativeConnector.capabilities)
        ? nativeConnector.capabilities.map(String)
        : undefined
    };
  }

  if (current.port !== undefined) {
    return {
      id: `legacy-serial:${String(current.port)}`,
      family: 'SERIAL',
      connected: !['closed', 'offline'].includes(String(current.state ?? '').toLowerCase()),
      displayName: 'Legacy serial connector'
    };
  }

  return undefined;
}

function mapOperation(state: string): OperationalState {
  const normalized = state.toLowerCase();
  if (normalized.includes('print')) return 'PRINTING';
  if (normalized.includes('pause')) return 'PAUSED';
  if (normalized.includes('error')) return 'ERROR';
  if (normalized.includes('operational') || normalized.includes('idle')) return 'IDLE';
  if (normalized.includes('connect')) return 'PREPARING';
  if (normalized.includes('offline') || normalized.includes('closed')) return 'UNAVAILABLE';
  return 'UNKNOWN';
}

export function normalizeState(
  printerId: string,
  connection: Record<string, unknown>,
  capabilitiesRevision: number,
  observedAt: number
): PrinterState {
  const current = (connection.current ?? {}) as Record<string, unknown>;
  const state = String(current.state ?? 'unknown');
  const operation = mapOperation(state);
  const disconnected = ['UNAVAILABLE', 'UNKNOWN'].includes(operation) && /offline|closed/i.test(state);
  return {
    printerId,
    connection: disconnected ? 'DISCONNECTED' : 'CONNECTED',
    operation,
    capabilitiesRevision,
    observedAt
  };
}

export function baselineCapabilities(): Capability[] {
  const ids: CapabilityId[] = ['PRINT', 'FILE_LIST', 'STORAGE_LIST'];
  return ids.map((id) => ({ id, supported: true }));
}

export function availabilityFor(
  capabilities: Capability[],
  state: PrinterState,
  capabilitiesRevision: number,
  observedAt: number
): OperationAvailability[] {
  return capabilities
    .filter((capability) => capability.supported)
    .map((capability) => {
      if (capability.id === 'PRINT') {
        const available = state.connection === 'CONNECTED' && state.operation === 'IDLE';
        return {
          capabilityId: capability.id,
          available,
          reason: available ? undefined : `PRINTER_${state.operation}`,
          observedAt,
          capabilitiesRevision
        };
      }
      return {
        capabilityId: capability.id,
        available: state.connection === 'CONNECTED',
        reason: state.connection === 'CONNECTED' ? undefined : 'PROVIDER_UNAVAILABLE',
        observedAt,
        capabilitiesRevision
      };
    });
}

export function normalizeFiles(payload: unknown): { storages: StorageRef[]; files: FileRef[] } {
  const storages: StorageRef[] = [];
  const files: FileRef[] = [];
  const record = (payload ?? {}) as Record<string, unknown>;

  const addStorage = (
    id: string,
    native: Record<string, unknown>,
    printerSide: boolean,
    defaultWritable = true
  ) => {
    const capabilities: CapabilityId[] = ['FILE_LIST', 'STORAGE_LIST'];
    const writable = native.writable === undefined ? defaultWritable : Boolean(native.writable);
    if (writable) capabilities.push('STORAGE_WRITE');
    storages.push({
      id,
      name: String(native.name ?? id),
      printerSide,
      removable: Boolean(native.removable ?? false),
      available: native.available === undefined ? true : Boolean(native.available),
      writable,
      capabilities
    });

    const nativeFiles = Array.isArray(native.files) ? native.files : [];
    for (const raw of nativeFiles) {
      if (!raw || typeof raw !== 'object') continue;
      const entry = raw as Record<string, unknown>;
      if (entry.type === 'folder') continue;
      const path = normalizeLogicalPath(String(entry.path ?? entry.name ?? ''));
      files.push({
        storageId: id,
        path,
        name: String(entry.name ?? path.split('/').at(-1) ?? path),
        displayName: entry.display === undefined ? undefined : String(entry.display),
        size: typeof entry.size === 'number' ? entry.size : undefined,
        modifiedAt: typeof entry.date === 'number' ? entry.date : undefined
      });
    }
  };

  if (Array.isArray(record.files)) {
    addStorage('local', { name: 'Local', files: record.files, writable: true }, false, true);
    return { storages, files };
  }

  const source = (record.storages && typeof record.storages === 'object' ? record.storages : record) as Record<string, unknown>;
  for (const [id, raw] of Object.entries(source)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const storage = raw as Record<string, unknown>;
    if (!Array.isArray(storage.files) && storage.available === undefined && storage.writable === undefined) continue;
    addStorage(id, storage, id === 'printer' || Boolean(storage.printerSide), true);
  }
  return { storages, files };
}
