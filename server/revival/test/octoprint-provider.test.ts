const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const { SyntheticOctoPrint } = require('../../test/provider-harness/protocol/octoprint/synthetic-octoprint.ts');
const { loadOctoPrintScenario } = require('../../test/provider-harness/protocol/octoprint/scenario-loader.ts');
const { OctoPrintProvider, OctoPrintProviderError } = require('../providers/octoprint/provider.ts');
const { availabilityFor, baselineCapabilities, normalizeState } = require('../providers/octoprint/normalization.ts');

function fixturePath(group: string, name: string): string {
  return path.join(__dirname, '..', '..', 'test', 'provider-harness', 'fixtures', 'octoprint', group, name);
}

async function snapshot(group: string, name: string) {
  const scenario = loadOctoPrintScenario(fixturePath(group, name));
  const synthetic = new SyntheticOctoPrint(scenario);
  await synthetic.start();
  try {
    const provider = new OctoPrintProvider(synthetic.endpoint(), 'provider-1', 'printer-1', undefined, () => 1000);
    return { value: await provider.snapshot(), requests: synthetic.capturedRequests() };
  } finally {
    await synthetic.stop();
  }
}

test('legacy OctoPrint 1.x normalizes without leaking serial-native fields', async () => {
  const { value, requests } = await snapshot('legacy', 'OP-LEGACY-001.json');
  assert.equal(value.identity.protocolVersion, '0.1');
  assert.equal(value.connector.family, 'SERIAL');
  assert.equal(value.state.connection, 'CONNECTED');
  assert.equal(value.state.operation, 'IDLE');
  assert.equal(value.storages[0].id, 'local');
  assert.equal(requests.filter((r:any)=>r.headers['x-octoprint-api-version']).length, 0);
  const serialized = JSON.stringify(value);
  assert.equal(serialized.includes('baudrate'), false);
  assert.equal(serialized.includes('printerProfile'), false);
  assert.equal(serialized.includes('options'), false);
});

test('OctoPrint 2.x compatibility mode negotiates but remains normalized', async () => {
  const { value, requests } = await snapshot('v2-compat', 'OP2-COMPAT-001.json');
  assert.equal(value.identity.protocolVersion, '0.1');
  assert.equal(value.connector.family, 'SERIAL');
  assert.ok(requests.some((r:any)=>r.path === '/api/version' && r.headers['x-octoprint-api-version'] === '2.0.0'));
});

test('OctoPrint 2.x native mode negotiates native protocol and connector/storage identities', async () => {
  const { value, requests } = await snapshot('v2-native', 'OP2-NATIVE-001.json');
  assert.equal(value.identity.protocolVersion, '2.0.0');
  assert.equal(value.connector.id, 'serial0');
  assert.equal(value.connector.family, 'SERIAL');
  assert.deepEqual(value.storages.map((s:any)=>s.id).sort(), ['local', 'printer']);
  assert.ok(requests.some((r:any)=>r.path === '/api/connection' && r.headers['x-octoprint-api-version'] === '2.0.0'));
});

test('support remains distinct from current operation availability', () => {
  const capabilities = baselineCapabilities();
  const state = normalizeState('printer-1', { current: { state: 'Printing' } }, 3, 1000);
  const availability = availabilityFor(capabilities, state, 3, 1000);
  assert.equal(capabilities.find((c:any)=>c.id === 'PRINT').supported, true);
  const print = availability.find((a:any)=>a.capabilityId === 'PRINT');
  assert.equal(print.available, false);
  assert.equal(print.reason, 'PRINTER_PRINTING');
  assert.equal(print.capabilitiesRevision, 3);
});

test('printer state and provider health are separate normalized dimensions', async () => {
  const { value } = await snapshot('legacy', 'OP-LEGACY-001.json');
  assert.equal(value.state.operation, 'IDLE');
  assert.deepEqual(
    { reachable: value.health.reachable, authenticated: value.health.authenticated, transportConnected: value.health.transportConnected },
    { reachable: true, authenticated: true, transportConnected: true }
  );
});

test('authentication and authorization failures remain distinct provider errors', async () => {
  class Transport {
    private status: number;
    constructor(status: number) { this.status = status; }
    async request() { return { status: this.status, ok: false, async json(){ return {}; } }; }
  }
  await assert.rejects(
    new OctoPrintProvider('http://local', 'p1', 'printer-1', new Transport(401)).snapshot(),
    (error:any) => error instanceof OctoPrintProviderError && error.category === 'AUTHENTICATION'
  );
  await assert.rejects(
    new OctoPrintProvider('http://local', 'p1', 'printer-1', new Transport(403)).snapshot(),
    (error:any) => error instanceof OctoPrintProviderError && error.category === 'AUTHORIZATION'
  );
});

test('capabilitiesRevision is monotonic and reflected in snapshots', async () => {
  const scenario = loadOctoPrintScenario(fixturePath('legacy', 'OP-LEGACY-001.json'));
  const synthetic = new SyntheticOctoPrint(scenario);
  await synthetic.start();
  try {
    const provider = new OctoPrintProvider(synthetic.endpoint(), 'provider-1', 'printer-1', undefined, () => 1000);
    provider.setCapabilitiesRevision(2);
    const value = await provider.snapshot();
    assert.equal(value.capabilitiesRevision, 2);
    assert.ok(value.availability.every((a:any)=>a.capabilitiesRevision === 2));
    assert.throws(()=>provider.setCapabilitiesRevision(1), /monotonically increase/);
  } finally { await synthetic.stop(); }
});

test('normalized boundary contains no OctoPrint-native top-level structures', async () => {
  for (const [group,name] of [
    ['legacy','OP-LEGACY-001.json'],
    ['v2-compat','OP2-COMPAT-001.json'],
    ['v2-native','OP2-NATIVE-001.json']
  ]) {
    const { value } = await snapshot(group, name);
    const forbidden = ['current','options','profiles','settingsApi','settingsSerial','apikey','api'];
    for (const key of forbidden) assert.equal(Object.prototype.hasOwnProperty.call(value,key), false, `${group} leaked ${key}`);
  }
});
