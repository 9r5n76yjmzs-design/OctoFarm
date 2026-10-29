/**
 * Browser projection explicitly selects provider-neutral fields and redacts string output; it never clones native objects.
 * @module
 */
import type { ProviderSnapshot } from '../core/provider-contract.ts';
import { requireSensitiveValueGuard } from './sensitive-values.ts';
import type { SensitiveValueGuard } from './sensitive-values.ts';

/**
 * Redacts an optional projected string.
 * @param value - Candidate value.
 * @param guard - Host secret guard.
 * @returns Redacted text or undefined.
 */
function safeString(value: unknown, guard: SensitiveValueGuard): string | undefined {
  return value === undefined ? undefined : guard.redact(String(value));
}

/**
 * Projects explicitly allowed nested fields and applies host-known secret redaction.
 * @param snapshot - Normalized provider snapshot.
 * @param sensitiveGuard - Required host-known secret guard.
 * @returns Safe browser-facing copy.
 * @throws Error when guard is missing or invalid.
 */
export function projectProviderForBrowser(
  snapshot: ProviderSnapshot,
  sensitiveGuard: SensitiveValueGuard
) {
  const guard = requireSensitiveValueGuard(sensitiveGuard);

  return {
    identity: {
      providerId: safeString(snapshot.identity.providerId, guard),
      providerInstanceId: safeString(snapshot.identity.providerInstanceId, guard),
      displayName: safeString(snapshot.identity.displayName, guard),
      providerVersion: safeString(snapshot.identity.providerVersion, guard),
      implementationVersion: safeString(snapshot.identity.implementationVersion, guard),
      protocolFamily: safeString(snapshot.identity.protocolFamily, guard),
      protocolVersion: safeString(snapshot.identity.protocolVersion, guard)
    },
    capabilitiesRevision: snapshot.capabilitiesRevision,
    capabilities: snapshot.capabilities.map((capability) => ({
      id: safeString(capability.id, guard),
      supported: Boolean(capability.supported),
      version: safeString(capability.version, guard)
    })),
    availability: snapshot.availability.map((availability) => ({
      capabilityId: safeString(availability.capabilityId, guard),
      available: Boolean(availability.available),
      observedAt: availability.observedAt,
      capabilitiesRevision: availability.capabilitiesRevision
    })),
    state: {
      printerId: safeString(snapshot.state.printerId, guard),
      connection: safeString(snapshot.state.connection, guard),
      operation: safeString(snapshot.state.operation, guard),
      capabilitiesRevision: snapshot.state.capabilitiesRevision,
      observedAt: snapshot.state.observedAt
    },
    health: {
      reachable: Boolean(snapshot.health.reachable),
      authenticated: Boolean(snapshot.health.authenticated),
      transportConnected: Boolean(snapshot.health.transportConnected),
      latencyMs: snapshot.health.latencyMs,
      lastSuccessfulContact: snapshot.health.lastSuccessfulContact,
      retrying: Boolean(snapshot.health.retrying),
      degraded: Boolean(snapshot.health.degraded),
      observedAt: snapshot.health.observedAt
    },
    connector: snapshot.connector ? {
      id: safeString(snapshot.connector.id, guard),
      family: safeString(snapshot.connector.family, guard),
      connected: Boolean(snapshot.connector.connected)
    } : undefined,
    storages: snapshot.storages.map((storage) => ({
      id: safeString(storage.id, guard),
      name: safeString(storage.name, guard),
      printerSide: Boolean(storage.printerSide),
      removable: Boolean(storage.removable),
      available: Boolean(storage.available),
      writable: Boolean(storage.writable),
      capabilities: storage.capabilities.map((capability) => safeString(capability, guard))
    })),
    files: snapshot.files.map((file) => ({
      storageId: safeString(file.storageId, guard),
      path: safeString(file.path, guard),
      name: safeString(file.name, guard),
      displayName: safeString(file.displayName, guard),
      size: file.size,
      modifiedAt: file.modifiedAt
    }))
  };
}
