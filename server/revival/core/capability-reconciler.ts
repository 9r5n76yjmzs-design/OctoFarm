/**
 * Tracks monotonic capability revisions independently for each provider instance and printer.
 * @module
 */
import type { DomainEvent } from './domain-event.ts';

/**
 * Rejects stale or duplicate capability revisions without mutating authoritative state.
 */
export class CapabilityRevisionReconciler {
  private readonly revisions = new Map<string, number>();

  /**
   * Consumes a capability-change event, updating the revision only when newer.
   * @param event - Normalized event with a capabilitiesRevision payload.
   * @returns True when the revision advanced; false for stale or repeated input.
   */
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

  /**
   * Reads the last accepted capability revision for one instance/printer pair.
   * @param providerInstanceId - Stable provider instance identity.
   * @param printerId - Printer identity within the instance.
   * @returns Current revision or undefined if none was observed.
   */
  get(providerInstanceId: string, printerId: string): number | undefined {
    return this.revisions.get(`${providerInstanceId}:${printerId}`);
  }
}
