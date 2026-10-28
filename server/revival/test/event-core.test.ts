const assert = require('node:assert/strict');
const { test } = require('node:test');
const { FakeClock } = require('../../test/provider-harness/host/fake-clock.ts');
const { FakeScheduler } = require('../../test/provider-harness/host/fake-scheduler.ts');
const { BoundedEventIngress } = require('../core/event-ingress.ts');
const { CapabilityRevisionReconciler } = require('../core/capability-reconciler.ts');
const { DomainStateReconciler } = require('../core/state-reconciler.ts');
const { EventController } = require('../core/event-controller.ts');
const { translateOctoPrintEvent } = require('../providers/octoprint/events.ts');
const { assertDomainEvent } = require('../core/domain-event.ts');

function event(id: string, observedAt: number, instance = 'p1', printer = 'printer1', type = 'PrintCompleted') {
  return { schemaVersion: 1, eventId: id, type, printerId: printer, providerId: 'octoprint', providerInstanceId: instance, occurredAt: observedAt, observedAt, payload: {} };
}

test('event envelope rejects unsupported schema versions', () => {
  assert.throws(() => assertDomainEvent({ ...event('a', 1), schemaVersion: 2 }), /schemaVersion/);
});

test('duplicate and replay delivery is idempotent', () => {
  const clock = new FakeClock();
  const scheduler = new FakeScheduler(clock);
  let count = 0;
  const ingress = new BoundedEventIngress(scheduler, () => count++, 4);
  assert.equal(ingress.enqueue(event('same', 1)).accepted, true);
  assert.equal(ingress.enqueue(event('same', 1)).duplicate, true);
  scheduler.runDue();
  assert.equal(count, 1);
});

test('per-stream order is preserved and streams remain independently identified', () => {
  const clock = new FakeClock();
  const scheduler = new FakeScheduler(clock);
  const seen = [];
  const ingress = new BoundedEventIngress(scheduler, (value) => seen.push(`${value.providerInstanceId}:${value.eventId}`), 8);
  ingress.enqueue(event('1', 1, 'a'));
  ingress.enqueue(event('2', 2, 'a'));
  ingress.enqueue(event('1b', 1, 'b'));
  scheduler.runDue();
  assert.deepEqual(seen.filter((value) => value.startsWith('a:')), ['a:1', 'a:2']);
  assert.ok(seen.includes('b:1b'));
});

test('bounded ingress rejects overload explicitly and degrades', () => {
  const clock = new FakeClock();
  const scheduler = new FakeScheduler(clock);
  const ingress = new BoundedEventIngress(scheduler, () => {}, 1);
  assert.equal(ingress.enqueue(event('1', 1)).accepted, true);
  assert.deepEqual(ingress.enqueue(event('2', 2)), { accepted: false, duplicate: false, degraded: true, reason: 'BACKPRESSURE' });
  assert.equal(ingress.status().degraded, true);
});

test('throwing consumer does not escape provider transport and marks degradation', () => {
  const clock = new FakeClock();
  const scheduler = new FakeScheduler(clock);
  const ingress = new BoundedEventIngress(scheduler, () => { throw new Error('consumer'); }, 4);
  ingress.enqueue(event('1', 1));
  assert.doesNotThrow(() => scheduler.runDue());
  assert.equal(ingress.status().consumerFailures, 1);
  assert.equal(ingress.status().degraded, true);
});

test('authoritative state rejects stale observations and accepts late newer reconciliation', () => {
  const reconciler = new DomainStateReconciler();
  const newer = { printerId: 'printer1', connection: 'CONNECTED', operation: 'PRINTING', capabilitiesRevision: 1, observedAt: 200 };
  const older = { ...newer, operation: 'IDLE', observedAt: 100 };
  assert.equal(reconciler.applySnapshot(newer), true);
  assert.equal(reconciler.applySnapshot(older), false);
  assert.equal(reconciler.get('printer1').operation, 'PRINTING');
  const late = { ...newer, operation: 'IDLE', observedAt: 300 };
  assert.equal(reconciler.applyEvent({ ...event('late', 300), type: 'PrinterStateChanged', payload: { state: late } }), true);
  assert.equal(reconciler.get('printer1').operation, 'IDLE');
});

test('OctoPrint event translation emits normalized facts without native payload leakage', () => {
  const normalized = translateOctoPrintEvent(
    { id: 'native-1', type: 'StateChanged', state: 'Printing', nativeMarker: 'private-provider-field', native: { port: '/dev/example' } },
    { providerInstanceId: 'p1', printerId: 'printer1', now: () => 50, capabilitiesRevision: 3 }
  );
  assert.equal(normalized.type, 'PrinterStateChanged');
  assert.equal(normalized.payload.state.operation, 'PRINTING');
  const serialized = JSON.stringify(normalized);
  assert.equal(serialized.includes('nativeMarker'), false);
  assert.equal(serialized.includes('/dev/example'), false);
});

class FakeTransport {
  handlers;
  closed = false;
  connect(handlers) { this.handlers = handlers; }
  close() { this.closed = true; }
  open() { this.handlers.onOpen(); }
  message(value) { this.handlers.onMessage(value); }
  drop(reason = 'drop') { this.handlers.onClose(reason); }
}

test('controller coalesces connect, reconnects with deterministic backoff, and stops at ceiling', () => {
  const clock = new FakeClock();
  const scheduler = new FakeScheduler(clock);
  const transports = [];
  const ingress = new BoundedEventIngress(scheduler, () => {}, 8);
  const controller = new EventController(
    () => { const transport = new FakeTransport(); transports.push(transport); return transport; },
    scheduler,
    ingress,
    (raw) => translateOctoPrintEvent(raw, { providerInstanceId: 'p1', printerId: 'printer1', now: () => clock.now(), capabilitiesRevision: 1 }),
    [10, 20]
  );
  controller.connect();
  controller.connect();
  assert.equal(transports.length, 1);
  transports[0].open();
  transports[0].drop();
  assert.equal(controller.state().state, 'RECONNECTING');
  scheduler.advanceBy(10);
  assert.equal(transports.length, 2);
  transports[1].drop();
  scheduler.advanceBy(20);
  assert.equal(transports.length, 3);
  transports[2].drop();
  assert.equal(controller.state().state, 'DEGRADED');
  assert.equal(controller.state().reason, 'RECONNECT_EXHAUSTED');
});

test('terminal shutdown cancels reconnect and ignores late transport callbacks', () => {
  const clock = new FakeClock();
  const scheduler = new FakeScheduler(clock);
  const transports = [];
  const delivered = [];
  const ingress = new BoundedEventIngress(scheduler, (value) => delivered.push(value), 8);
  const controller = new EventController(
    () => { const transport = new FakeTransport(); transports.push(transport); return transport; },
    scheduler,
    ingress,
    (raw) => translateOctoPrintEvent(raw, { providerInstanceId: 'p1', printerId: 'printer1', now: () => clock.now(), capabilitiesRevision: 1 }),
    [10]
  );
  controller.connect();
  const first = transports[0];
  first.drop();
  assert.equal(scheduler.pending(), 1);
  controller.shutdown();
  scheduler.advanceBy(100);
  assert.equal(transports.length, 1);
  first.open();
  first.message({ id: 'late', type: 'PrintDone' });
  scheduler.runDue();
  assert.equal(delivered.length, 0);
  assert.equal(controller.state().state, 'SHUTDOWN');
  assert.throws(() => controller.connect(), /shutdown/);
});

test('shutdown during connect closes partial transport and ignores late open', () => {
  const clock = new FakeClock();
  const scheduler = new FakeScheduler(clock);
  const transports = [];
  const ingress = new BoundedEventIngress(scheduler, () => {}, 8);
  const controller = new EventController(
    () => { const transport = new FakeTransport(); transports.push(transport); return transport; },
    scheduler,
    ingress,
    () => undefined,
    [10]
  );
  controller.connect();
  const first = transports[0];
  controller.shutdown();
  assert.equal(first.closed, true);
  first.open();
  assert.equal(controller.state().state, 'SHUTDOWN');
  assert.equal(scheduler.pending(), 0);
});

test('capability revision reconciliation advances only on material newer revisions', () => {
  const reconciler = new CapabilityRevisionReconciler();
  const base = { ...event('cap-2', 20), type: 'CapabilitiesChanged', payload: { capabilitiesRevision: 2 } };
  assert.equal(reconciler.applyEvent(base), true);
  assert.equal(reconciler.applyEvent({ ...base, eventId: 'replay' }), false);
  assert.equal(reconciler.applyEvent({ ...base, eventId: 'cap-3', payload: { capabilitiesRevision: 3 }, observedAt: 30 }), true);
  assert.equal(reconciler.get('p1', 'printer1'), 3);
});
