import type { ProviderSnapshot } from '../core/provider-contract.ts';

export function projectProviderForBrowser(snapshot: ProviderSnapshot) {
  return {
    identity: {
      providerId: snapshot.identity.providerId,
      providerInstanceId: snapshot.identity.providerInstanceId,
      displayName: snapshot.identity.displayName,
      providerVersion: snapshot.identity.providerVersion,
      implementationVersion: snapshot.identity.implementationVersion,
      protocolFamily: snapshot.identity.protocolFamily,
      protocolVersion: snapshot.identity.protocolVersion
    },
    capabilitiesRevision: snapshot.capabilitiesRevision,
    capabilities: snapshot.capabilities.map((capability) => ({
      id: capability.id,
      supported: capability.supported,
      version: capability.version
    })),
    availability: snapshot.availability.map((availability) => ({
      capabilityId: availability.capabilityId,
      available: availability.available,
      observedAt: availability.observedAt,
      capabilitiesRevision: availability.capabilitiesRevision
    })),
    state: { ...snapshot.state },
    health: {
      reachable: snapshot.health.reachable,
      authenticated: snapshot.health.authenticated,
      transportConnected: snapshot.health.transportConnected,
      latencyMs: snapshot.health.latencyMs,
      lastSuccessfulContact: snapshot.health.lastSuccessfulContact,
      retrying: snapshot.health.retrying,
      degraded: snapshot.health.degraded,
      observedAt: snapshot.health.observedAt
    },
    connector: snapshot.connector ? {
      id: snapshot.connector.id,
      family: snapshot.connector.family,
      connected: snapshot.connector.connected
    } : undefined,
    storages: snapshot.storages.map((storage) => ({
      id: storage.id,
      name: storage.name,
      printerSide: storage.printerSide,
      removable: storage.removable,
      available: storage.available,
      writable: storage.writable,
      capabilities: [...storage.capabilities]
    })),
    files: snapshot.files.map((file) => ({
      storageId: file.storageId,
      path: file.path,
      name: file.name,
      displayName: file.displayName,
      size: file.size,
      modifiedAt: file.modifiedAt
    }))
  };
}
