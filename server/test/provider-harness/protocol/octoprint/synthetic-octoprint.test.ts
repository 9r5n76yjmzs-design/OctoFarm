const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { FakeClock } = require('../../host/fake-clock.ts');
const { FakeScheduler } = require('../../host/fake-scheduler.ts');
const { loadOctoPrintScenario } = require('./scenario-loader.ts');
const { SyntheticOctoPrint } = require('./synthetic-octoprint.ts');

function fixturePath(group: string, name: string): string {
  return path.join(__dirname, '..', '..', 'fixtures', 'octoprint', group, name);
}

async function withSynthetic(group: string, name: string, fn: (synthetic: any) => Promise<void>): Promise<void> {
  const scenario = loadOctoPrintScenario(fixturePath(group, name));
  const synthetic = new SyntheticOctoPrint(scenario);
  await synthetic.start();
  try { await fn(synthetic); } finally { await synthetic.stop(); }
}

test('loads legacy, 2.x compatibility, and 2.x native fixture modes', () => {
  assert.equal(loadOctoPrintScenario(fixturePath('legacy','OP-LEGACY-001.json')).mode, 'LEGACY');
  assert.equal(loadOctoPrintScenario(fixturePath('v2-compat','OP2-COMPAT-001.json')).mode, 'V2_COMPAT');
  assert.equal(loadOctoPrintScenario(fixturePath('v2-native','OP2-NATIVE-001.json')).mode, 'V2_NATIVE');
});

test('serves fixture responses on loopback and captures requests', async () => {
  await withSynthetic('legacy','OP-LEGACY-001.json', async (synthetic) => {
    assert.match(synthetic.endpoint(), /^http:\/\/127\.0\.0\.1:\d+$/);
    const response = await fetch(`${synthetic.endpoint()}/api/version`, { headers: { 'x-request-id': 'REQ-001' } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { api: '0.1', server: '1.9.3', text: 'OctoPrint 1.x synthetic' });
    const captured = synthetic.capturedRequests();
    assert.equal(captured.length, 1);
    assert.equal(captured[0].path, '/api/version');
    assert.equal(captured[0].headers['x-request-id'], 'REQ-001');
  });
});

test('captures request bodies without requiring production services', async () => {
  await withSynthetic('v2-native','OP2-NATIVE-001.json', async (synthetic) => {
    const response = await fetch(`${synthetic.endpoint()}/api/job`, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ command:'start' }) });
    assert.equal(response.status, 204);
    assert.equal(synthetic.capturedRequests()[0].body, JSON.stringify({ command:'start' }));
  });
});

test('injects malformed payloads as raw response text', async () => {
  await withSynthetic('v2-compat','OP2-COMPAT-001.json', async (synthetic) => {
    const response = await fetch(`${synthetic.endpoint()}/api/malformed`);
    assert.equal(await response.text(), '{not-valid-json');
  });
});

test('supports deterministic delayed responses through FakeScheduler', async () => {
  const scenario = loadOctoPrintScenario(fixturePath('v2-compat','OP2-COMPAT-001.json'));
  const clock = new FakeClock();
  const scheduler = new FakeScheduler(clock);
  const synthetic = new SyntheticOctoPrint(scenario,{scheduler});
  await synthetic.start();
  try {
    let settled = false;
    const pending = fetch(`${synthetic.endpoint()}/api/delayed`).then(async (response:any)=>{ settled=true; return response.json(); });
    while (synthetic.capturedRequests().length === 0) await new Promise((resolve)=>setImmediate(resolve));
    assert.equal(settled,false);
    scheduler.advanceBy(499);
    await new Promise((resolve)=>setImmediate(resolve));
    assert.equal(settled,false);
    scheduler.advanceBy(1);
    assert.deepEqual(await pending,{ delayed:true });
  } finally { await synthetic.stop(); }
});

test('injects deterministic disconnect failures', async () => {
  await withSynthetic('v2-compat','OP2-COMPAT-001.json', async (synthetic) => {
    await assert.rejects(fetch(`${synthetic.endpoint()}/api/disconnect`));
  });
});

test('returns deterministic 404 for routes absent from the fixture', async () => {
  await withSynthetic('legacy','OP-LEGACY-001.json', async (synthetic) => {
    const response = await fetch(`${synthetic.endpoint()}/api/not-configured`);
    assert.equal(response.status,404);
    assert.deepEqual(await response.json(),{error:'fixture route not found'});
  });
});

test('service lifecycle rejects double start and allows idempotent stop', async () => {
  const scenario = loadOctoPrintScenario(fixturePath('legacy','OP-LEGACY-001.json'));
  const synthetic = new SyntheticOctoPrint(scenario);
  await synthetic.start();
  await assert.rejects(synthetic.start(), /already started/);
  await synthetic.stop();
  await synthetic.stop();
  assert.throws(() => synthetic.endpoint(), /not started/);
});
