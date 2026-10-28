import { assertDomainEvent } from '../../core/domain-event.ts';
import type { DomainEvent } from '../../core/domain-event.ts';
import type { PrinterState } from '../../core/provider-contract.ts';

type Context = { providerInstanceId: string; printerId: string; now: () => number; capabilitiesRevision: number };

function base(context: Context, id: string, type: DomainEvent['type'], occurredAt: number, payload: unknown): DomainEvent {
  return assertDomainEvent({
    schemaVersion: 1,
    eventId: id,
    type,
    printerId: context.printerId,
    providerId: 'octoprint',
    providerInstanceId: context.providerInstanceId,
    occurredAt,
    observedAt: context.now(),
    payload
  });
}

function stateFromNative(context: Context, native: string): PrinterState {
  const value = native.toLowerCase();
  let operation: PrinterState['operation'] = 'UNKNOWN';
  if (value.includes('print')) operation = 'PRINTING';
  else if (value.includes('pause')) operation = 'PAUSED';
  else if (value.includes('operational') || value.includes('idle')) operation = 'IDLE';
  else if (value.includes('error')) operation = 'ERROR';
  else if (value.includes('offline') || value.includes('closed')) operation = 'UNAVAILABLE';

  return {
    printerId: context.printerId,
    connection: operation === 'UNAVAILABLE' ? 'DISCONNECTED' : 'CONNECTED',
    operation,
    capabilitiesRevision: context.capabilitiesRevision,
    observedAt: context.now()
  };
}

export function translateOctoPrintEvent(raw: unknown, context: Context): DomainEvent | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  const native = String(record.type ?? record.event ?? '');
  const id = String(record.id ?? `${context.providerInstanceId}:${context.printerId}:${native}:${String(record.seq ?? context.now())}`);
  const occurredAt = typeof record.occurredAt === 'number' ? record.occurredAt : context.now();

  if (native === 'PrintStarted') return base(context, id, 'PrintStarted', occurredAt, { jobId: record.jobId ? String(record.jobId) : undefined });
  if (native === 'PrintDone' || native === 'PrintCompleted') return base(context, id, 'PrintCompleted', occurredAt, { jobId: record.jobId ? String(record.jobId) : undefined, completedAt: occurredAt });
  if (native === 'PrintFailed') return base(context, id, 'PrintFailed', occurredAt, { jobId: record.jobId ? String(record.jobId) : undefined });
  if (native === 'Disconnected') return base(context, id, 'ProviderDisconnected', occurredAt, { reason: 'transport' });
  if (native === 'Connected') return base(context, id, 'ProviderConnected', occurredAt, {});
  if (native === 'CapabilitiesChanged') return base(context, id, 'CapabilitiesChanged', occurredAt, { capabilitiesRevision: Number(record.capabilitiesRevision ?? context.capabilitiesRevision) });
  if (native === 'StateChanged') return base(context, id, 'PrinterStateChanged', occurredAt, { state: stateFromNative(context, String(record.state ?? 'unknown')) });
  return undefined;
}
