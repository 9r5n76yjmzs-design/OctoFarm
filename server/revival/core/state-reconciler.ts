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
  private readonly states = new Map<string, VersionedState>();
  private ordinal = 0;

  /**
   * Reconciles a directly observed normalized printer state.
   * @param state - New provider snapshot printer state.
   * @returns True if accepted, false if stale.
   */
  applySnapshot(state: PrinterState): boolean { return this.apply(state, state.observedAt); }

  /**
   * Reconciles a state-changed event using its event observation timestamp.
   * @param event - Normalized event with state payload.
   * @returns True if accepted, false if stale.
   */
  applyEvent(event: DomainEvent<{ state: PrinterState }>): boolean {
    if (event.type !== 'PrinterStateChanged') return false;
    return this.apply(event.payload.state, event.observedAt);
  }

  /**
   * Returns the latest accepted printer state.
   * @param printerId - Stable printer identifier.
   * @returns State or undefined when not observed.
   */
  get(printerId: string): PrinterState | undefined { return this.states.get(printerId)?.state; }

  /**
   * Advances authoritative state only when ordering rules accept the observation.
   * @param state - Candidate printer state.
   * @param observedAt - Ordering timestamp.
   * @returns True when stored; false for stale observations.
   */
  private apply(state: PrinterState, observedAt: number): boolean {
    const current = this.states.get(state.printerId);
    const nextOrdinal = ++this.ordinal;
    if (current && observedAt < current.observedAt) return false;
    if (current && observedAt === current.observedAt && nextOrdinal <= current.ordinal) return false;
    this.states.set(state.printerId, { state: { ...state, observedAt }, observedAt, ordinal: nextOrdinal });
    return true;
  }
}
