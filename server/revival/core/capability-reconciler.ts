/**
 * Tracks monotonic capability revisions independently for each provider instance and printer.
 * @module
 */
import type { DomainEvent } from './domain-event.ts';

/**
 * Rejects stale or duplicate capability revisions without mutating authoritative state.
 */
export class CapabilityRevisionReconciler {
  private readonly revisions = new Map<string, Map<string, number>>();

  /**
   * Consumes a capability-change event, updating the revision only when newer.
   * @param event - Normalized event with a capabilitiesRevision payload.
   * @returns True when the revision advanced; false for stale or repeated input.
   * @throws Error for invalid revision or identity dimensions.
   */
  applyEvent(event: DomainEvent<{ capabilitiesRevision: number }>): boolean {
    if (event.type !== 'CapabilitiesChanged') return false;
    this.assertIdentity(event.providerInstanceId, 'providerInstanceId');
    this.assertIdentity(event.printerId, 'printerId');
    const revision = event.payload.capabilitiesRevision;
    if (!Number.isInteger(revision) || revision < 1) throw new Error('invalid capabilitiesRevision');
    const instanceRevisions = this.revisions.get(event.providerInstanceId) ?? new Map<string, number>();
    const current = instanceRevisions.get(event.printerId) ?? 0;
    if (revision <= current) return false;
    instanceRevisions.set(event.printerId, revision);
    this.revisions.set(event.providerInstanceId, instanceRevisions);
    return true;
  }

  /**
   * Reads the last accepted capability revision for one instance/printer pair.
   * @param providerInstanceId - Stable provider instance identity.
   * @param printerId - Printer identity within the instance.
   * @returns Current revision or undefined if none was observed.
   * @throws Error for invalid provider-instance or printer identity.
   */
  get(providerInstanceId: string, printerId: string): number | undefined {
    this.assertIdentity(providerInstanceId, 'providerInstanceId');
    this.assertIdentity(printerId, 'printerId');
    return this.revisions.get(providerInstanceId)?.get(printerId);
  }

  /**
   * Rejects empty, oversized, or control-bearing identity dimensions.
   * @param value - Provider-instance or printer identity.
   * @param name - Diagnostic field label.
   * @returns Nothing on success.
   */
  private assertIdentity(value: string, name: string): void {
    if (typeof value !== 'string' || value.length < 1 || value.length > 256 || /[\u0000-\u001f\u007f-\u009f]/.test(value)) {
      throw new Error(`${name} must be a bounded identity without control characters`);
    }
  }
}
