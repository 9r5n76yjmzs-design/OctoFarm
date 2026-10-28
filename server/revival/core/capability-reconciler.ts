import type { DomainEvent } from './domain-event.ts';

export class CapabilityRevisionReconciler {
  private readonly revisions = new Map<string, number>();

  applyEvent(event: DomainEvent<{ capabilitiesRevision: number }>): boolean {
    if (event.type !== 'CapabilitiesChanged') return false;
    const revision = event.payload.capabilitiesRevision;
    if (!Number.isInteger(revision) || revision < 1) throw new Error('invalid capabilitiesRevision');
    const key = `${event.providerInstanceId}:${event.printerId}`;
    const current = this.revisions.get(key) ?? 0;
    if (revision <= current) return false;
    this.revisions.set(key, revision);
    return true;
  }

  get(providerInstanceId: string, printerId: string): number | undefined {
    return this.revisions.get(`${providerInstanceId}:${printerId}`);
  }
}
