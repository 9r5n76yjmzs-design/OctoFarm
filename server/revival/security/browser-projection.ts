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
    capabilities: snapshot.capabilities,
    availability: snapshot.availability,
    state: snapshot.state,
    health: snapshot.health,
    connector: snapshot.connector,
    storages: snapshot.storages,
    files: snapshot.files
  };
}
