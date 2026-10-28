import type { DomainEvent } from './domain-event.ts';
import type { PrinterState } from './provider-contract.ts';

interface VersionedState { state: PrinterState; observedAt: number; ordinal: number; }

export class DomainStateReconciler {
  private readonly states = new Map<string, VersionedState>();
  private ordinal = 0;

  applySnapshot(state: PrinterState): boolean { return this.apply(state, state.observedAt); }

  applyEvent(event: DomainEvent<{ state: PrinterState }>): boolean {
    if (event.type !== 'PrinterStateChanged') return false;
    return this.apply(event.payload.state, event.observedAt);
  }

  get(printerId: string): PrinterState | undefined { return this.states.get(printerId)?.state; }

  private apply(state: PrinterState, observedAt: number): boolean {
    const current = this.states.get(state.printerId);
    const nextOrdinal = ++this.ordinal;
    if (current && observedAt < current.observedAt) return false;
    if (current && observedAt === current.observedAt && nextOrdinal <= current.ordinal) return false;
    this.states.set(state.printerId, { state: { ...state, observedAt }, observedAt, ordinal: nextOrdinal });
    return true;
  }
}
