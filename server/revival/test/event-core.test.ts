/**
 * Deterministic event ingress/replay, bounded queue, state reconciliation and lifecycle regression evidence.
 * @module
 */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { FakeClock } = require('../../test/provider-harness/host/fake-clock.ts');
const { FakeScheduler } = require('../../test/provider-harness/host/fake-scheduler.ts');
const { BoundedEventIngress } = require('../core/event-ingress.ts');
const { CapabilityRevisionReconciler } = require('../core/capability-reconciler.ts');
const { DomainStateReconciler } = require('../core/state-reconciler.ts');
const { EventController } = require('../core/event-controller.ts');
const { translateOctoPrintEvent } = require('../providers/octoprint/events.ts');
const { assertDomainEvent, replayKey, streamKey } = require('../core/domain-event.ts');

function event(id: string, observedAt: number, instance = 'p1', printer = 'printer1', type = 'PrintCompleted') {
  return { schemaVersion: 1, eventId: id, type, printerId: printer, providerId: 'octoprint', providerInstanceId: instance, occurredAt: observedAt, observedAt, payload: {} };
}

test('event envelope rejects unsupported schema versions', () => {
  assert.throws(() => assertDomainEvent({ ...event('a', 1), schemaVersion: 2 }), /schemaVersion/);
});

test('event envelope rejects undeclared fields and materializes a canonical copy for ingress', () => {
  const secret = 'SYNTHETIC-AF002-SECRET';
  assert.throws(
    () => assertDomainEvent({ ...event('hostile-envelope', 1), apiKey: secret, native: { authorization: secret } }),
    /unsupported field/
  );

  const inherited = Object.assign(Object.create({ apiKey: secret }), event('inherited-envelope', 1));
  assert.throws(() => assertDomainEvent(inherited), /plain object/);

  const original = event('canonical-copy', 2);
  const normalized = assertDomainEvent(original);
  assert.notEqual(normalized, original);
  assert.notEqual(normalized.payload, original.payload);

  const clock = new FakeClock();
  const scheduler = new FakeScheduler(clock);
  const delivered = [];
  const ingress = new BoundedEventIngress(scheduler, (value) => delivered.push(value), 4);
  assert.equal(ingress.enqueue(original).accepted, true);
  original.printerId = 'mutated-printer';
  original.payload.native = { apiKey: secret };
  scheduler.runDue();

  assert.equal(delivered[0].printerId, 'printer1');
  assert.equal(Object.prototype.hasOwnProperty.call(delivered[0].payload, 'native'), false);
  assert.equal(JSON.stringify(delivered[0]).includes(secret), false);
});

test('event normalization rejects accessor properties before reading provider-controlled values', () => {
  let reads = 0;
  const payload = {};
  Object.defineProperty(payload, 'connection', {
    enumerable: true,
    get() { return ++reads === 1 ? 'CONNECTED' : 'BROKEN'; }
  });

  assert.throws(
    () => assertDomainEvent({ ...event('accessor-event', 1, 'p1', 'printer1', 'PrinterConnectionChanged'), payload }),
    /data properties/
  );
  assert.equal(reads, 0);
});

test('identity tuple keys remain distinct for delimiter-containing IDs and reject controls', () => {
  const left = event('event:c', 1, 'instance:a', 'printer:b');
  const right = event('event', 1, 'instance', 'a:printer:b');
  assert.notEqual(streamKey(left), streamKey(right));
  assert.notEqual(replayKey(left), replayKey(right));

  assert.throws(
    () => assertDomainEvent(event('event\u0000suffix', 1, 'instance', 'printer1')),
    /control character/
  );
  assert.throws(
    () => assertDomainEvent(event('event', 1, 'instance\u0000suffix', 'printer1')),
    /control character/
  );
  assert.throws(
    () => assertDomainEvent(event('event\u0085suffix', 1, 'instance', 'printer1')),
    /control character/
  );
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
  assert.equal(reconciler.applySnapshot('provider-a', newer), true);
  assert.equal(reconciler.applySnapshot('provider-a', older), false);
  assert.equal(reconciler.get('provider-a', 'printer1').operation, 'PRINTING');
  const late = { ...newer, operation: 'IDLE', observedAt: 300 };
  assert.equal(reconciler.applyEvent({ ...event('late', 300, 'provider-a'), type: 'PrinterStateChanged', payload: { state: late } }), true);
  assert.equal(reconciler.get('provider-a', 'printer1').operation, 'IDLE');
});

test('state and capability authority remain independent across provider instances and delimiter pairs', () => {
  const states = new DomainStateReconciler();
  const stateA = { printerId: 'shared', connection: 'CONNECTED', operation: 'PRINTING', capabilitiesRevision: 1, observedAt: 200 };
  const stateB = { ...stateA, operation: 'IDLE', observedAt: 100 };
  assert.equal(states.applySnapshot('provider-a', stateA), true);
  assert.equal(states.applySnapshot('provider-b', stateB), true);
  assert.equal(states.get('provider-a', 'shared').operation, 'PRINTING');
  assert.equal(states.get('provider-b', 'shared').operation, 'IDLE');
  assert.throws(() => states.applySnapshot('provider\u0000c', stateA), /control characters/);
  assert.throws(() => states.get('provider\u0085c', 'shared'), /control characters/);

  const callerCopy = states.get('provider-a', 'shared');
  callerCopy.operation = 'ERROR';
  assert.equal(states.get('provider-a', 'shared').operation, 'PRINTING');

  const capabilities = new CapabilityRevisionReconciler();
  const first = { ...event('cap-a', 1, 'a', 'b:c'), type: 'CapabilitiesChanged', payload: { capabilitiesRevision: 2 } };
  const second = { ...event('cap-b', 1, 'a:b', 'c'), type: 'CapabilitiesChanged', payload: { capabilitiesRevision: 1 } };
  assert.equal(capabilities.applyEvent(first), true);
  assert.equal(capabilities.applyEvent(second), true);
  assert.equal(capabilities.get('a', 'b:c'), 2);
  assert.equal(capabilities.get('a:b', 'c'), 1);
  assert.throws(() => capabilities.get('a\u0000b', 'c'), /control characters/);
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

class ThrowingCloseTransport extends FakeTransport {
  close() {
    this.closed = true;
    throw new Error('SYNTHETIC-AF004-CLOSE-SECRET');
  }
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

test('malformed recognized messages are contained, redacted, degraded, and explicitly recoverable', () => {
  const malformedMessages = [
    { id: 'bad-revision', type: 'CapabilitiesChanged', capabilitiesRevision: 'not-an-integer' },
    { id: 'x'.repeat(513), type: 'PrintDone' },
    { id: 'bad-time', type: 'PrintDone', occurredAt: Number.NaN }
  ];

  for (const raw of malformedMessages) {
    const clock = new FakeClock();
    const scheduler = new FakeScheduler(clock);
    const transports = [];
    const ingress = new BoundedEventIngress(scheduler, () => {}, 8);
    const controller = new EventController(
      () => { const transport = new FakeTransport(); transports.push(transport); return transport; },
      scheduler,
      ingress,
      (value) => translateOctoPrintEvent(value, { providerInstanceId: 'p1', printerId: 'printer1', now: () => clock.now(), capabilitiesRevision: 1 }),
      [10]
    );

    controller.connect();
    const first = transports[0];
    first.open();
    assert.doesNotThrow(() => first.message(raw));
    assert.deepEqual(controller.state(), {
      state: 'DEGRADED',
      reconnectAttempts: 0,
      reason: 'EVENT_TRANSLATION_FAILED',
      terminal: false,
      messageFailures: 1
    });

    controller.connect();
    assert.equal(first.closed, true);
    assert.equal(transports.length, 2);
    transports[1].open();
    assert.equal(controller.state().state, 'CONNECTED');
    controller.shutdown();
    assert.equal(controller.state().state, 'SHUTDOWN');
    assert.doesNotThrow(() => first.message({ id: 'late', type: 'PrintDone' }));
  }
});

test('ingress failures cannot leak provider text or escape the transport callback', () => {
  const scheduler = new FakeScheduler(new FakeClock());
  const transports = [];
  const controller = new EventController(
    () => { const transport = new FakeTransport(); transports.push(transport); return transport; },
    scheduler,
    { enqueue() { throw new Error('SYNTHETIC-AF004-SECRET'); } },
    () => event('valid', 1),
    [10]
  );

  controller.connect();
  transports[0].open();
  assert.doesNotThrow(() => transports[0].message({ type: 'anything' }));
  assert.equal(controller.state().state, 'DEGRADED');
  assert.equal(controller.state().reason, 'EVENT_INGRESS_FAILED');
  assert.equal(controller.state().messageFailures, 1);
  assert.equal(JSON.stringify(controller.state()).includes('SYNTHETIC-AF004-SECRET'), false);
});

test('transport close failures cannot block explicit degraded recovery', () => {
  const scheduler = new FakeScheduler(new FakeClock());
  const transports = [];
  const ingress = new BoundedEventIngress(scheduler, () => {}, 8);
  const controller = new EventController(
    () => {
      const transport = transports.length === 0 ? new ThrowingCloseTransport() : new FakeTransport();
      transports.push(transport);
      return transport;
    },
    scheduler,
    ingress,
    () => { throw new Error('malformed'); },
    [10]
  );

  controller.connect();
  transports[0].open();
  transports[0].message({ type: 'bad' });
  assert.equal(controller.state().state, 'DEGRADED');
  assert.doesNotThrow(() => controller.connect());
  assert.equal(transports[0].closed, true);
  assert.equal(transports.length, 2);
});

test('transport close failures cannot prevent terminal shutdown finalization', () => {
  const scheduler = new FakeScheduler(new FakeClock());
  const transport = new ThrowingCloseTransport();
  const ingress = new BoundedEventIngress(scheduler, () => {}, 8);
  const controller = new EventController(
    () => transport,
    scheduler,
    ingress,
    () => event('valid', 1),
    [10]
  );

  controller.connect();
  transport.open();
  assert.doesNotThrow(() => controller.shutdown());
  assert.equal(transport.closed, true);
  assert.equal(controller.state().state, 'SHUTDOWN');
  assert.equal(controller.state().terminal, true);
  assert.equal(JSON.stringify(controller.state()).includes('SYNTHETIC-AF004-CLOSE-SECRET'), false);
});

test('capability revision reconciliation advances only on material newer revisions', () => {
  const reconciler = new CapabilityRevisionReconciler();
  const base = { ...event('cap-2', 20), type: 'CapabilitiesChanged', payload: { capabilitiesRevision: 2 } };
  assert.equal(reconciler.applyEvent(base), true);
  assert.equal(reconciler.applyEvent({ ...base, eventId: 'replay' }), false);
  assert.equal(reconciler.applyEvent({ ...base, eventId: 'cap-3', payload: { capabilitiesRevision: 3 }, observedAt: 30 }), true);
  assert.equal(reconciler.get('p1', 'printer1'), 3);
});


test('normalized event boundary rejects provider-native and credential-shaped payload fields', () => {
  assert.throws(
    () => assertDomainEvent({
      ...event('hostile', 1),
      payload: {
        authorization: 'Bearer SYNTHETIC-R3-SECRET',
        native: { apiKey: 'SYNTHETIC-R3-SECRET' }
      }
    }),
    /unsupported field/
  );
});

test('replay suppression is scoped by provider instance identity', () => {
  const clock = new FakeClock();
  const scheduler = new FakeScheduler(clock);
  const delivered = [];
  const ingress = new BoundedEventIngress(scheduler, (value) => delivered.push(value), 4, 8);

  assert.equal(ingress.enqueue(event('same-native-id', 1, 'provider-a')).accepted, true);
  assert.equal(ingress.enqueue(event('same-native-id', 1, 'provider-b')).accepted, true);
  scheduler.runDue();

  assert.deepEqual(
    delivered.map((value) => value.providerInstanceId).sort(),
    ['provider-a', 'provider-b']
  );
});

test('replay suppression memory remains bounded after sustained unique event traffic', () => {
  let nextId = 0;
  const scheduler = {
    schedule(_delay, callback) {
      callback();
      return ++nextId;
    }
  };
  const ingress = new BoundedEventIngress(scheduler, () => {}, 1, 32);

  for (let i = 0; i < 5000; i++) {
    assert.equal(ingress.enqueue(event(`unique-${i}`, i + 1)).accepted, true);
  }

  assert.equal(ingress.status().queued, 0);
  assert.equal(ingress.status().dedupeEntries, 32);
  assert.equal(ingress.status().dedupeCapacity, 32);
});


test('PrinterStateChanged cannot target a different printer than the event envelope', () => {
  assert.throws(
    () => assertDomainEvent({
      ...event('cross-printer', 10, 'provider-a', 'printer-a', 'PrinterStateChanged'),
      payload: {
        state: {
          printerId: 'printer-b',
          connection: 'CONNECTED',
          operation: 'IDLE',
          capabilitiesRevision: 1,
          observedAt: 10
        }
      }
    }),
    /must match event printerId/
  );
});
