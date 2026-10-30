/**
 * Rejects stale printer observations so older events cannot roll authoritative state backward.
 * @module
 */
import type { DomainEvent } from './domain-event.ts';
import type { PrinterState } from './provider-contract.ts';

interface VersionedState { state: PrinterState; observedAt: number; ordinal: number; }

/**
 * Tracks last accepted per-printer observation and uses an ordinal to break same-time ties.
 */
export class DomainStateReconciler {
  private readonly states = new Map<string, Map<string, VersionedState>>();
  private ordinal = 0;

  /**
   * Reconciles a directly observed normalized printer state.
   * @param providerInstanceId - Provider instance that produced the snapshot.
   * @param state - New provider snapshot printer state.
   * @returns True if accepted, false if stale.
   * @throws Error for invalid provider-instance or printer identity.
   */
  applySnapshot(providerInstanceId: string, state: PrinterState): boolean {
    return this.apply(providerInstanceId, state, state.observedAt);
  }

  /**
   * Reconciles a state-changed event using its event observation timestamp.
   * @param event - Normalized event with state payload.
   * @returns True if accepted, false if stale.
   * @throws Error for invalid provider-instance or printer identity.
   */
  applyEvent(event: DomainEvent<{ state: PrinterState }>): boolean {
    if (event.type !== 'PrinterStateChanged') return false;
    return this.apply(event.providerInstanceId, event.payload.state, event.observedAt);
  }

  /**
   * Returns the latest accepted printer state.
   * @param providerInstanceId - Provider instance authority scope.
   * @param printerId - Stable printer identifier within the instance.
   * @returns State or undefined when not observed.
   * @throws Error for invalid provider-instance or printer identity.
   */
  get(providerInstanceId: string, printerId: string): PrinterState | undefined {
    this.assertIdentity(providerInstanceId, 'providerInstanceId');
    this.assertIdentity(printerId, 'printerId');
    const state = this.states.get(providerInstanceId)?.get(printerId)?.state;
    return state ? { ...state } : undefined;
  }

  /**
   * Advances authoritative state only when ordering rules accept the observation.
   * @param providerInstanceId - Provider instance authority scope.
   * @param state - Candidate printer state.
   * @param observedAt - Ordering timestamp.
   * @returns True when stored; false for stale observations.
   */
  private apply(providerInstanceId: string, state: PrinterState, observedAt: number): boolean {
    this.assertIdentity(providerInstanceId, 'providerInstanceId');
    this.assertIdentity(state.printerId, 'printerId');
    const instanceStates = this.states.get(providerInstanceId) ?? new Map<string, VersionedState>();
    const current = instanceStates.get(state.printerId);
    const nextOrdinal = ++this.ordinal;
    if (current && observedAt < current.observedAt) return false;
    if (current && observedAt === current.observedAt && nextOrdinal <= current.ordinal) return false;
    instanceStates.set(state.printerId, { state: { ...state, observedAt }, observedAt, ordinal: nextOrdinal });
    this.states.set(providerInstanceId, instanceStates);
    return true;
  }

  /**
   * Rejects empty, oversized, or control-bearing authority dimensions.
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
