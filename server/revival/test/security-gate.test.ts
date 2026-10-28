const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { HostNetworkClient } = require('../security/host-network.ts');
const { HostOperationBroker, SecurityDeniedError } = require('../security/operation-broker.ts');
const { serializeProviderDiagnostic } = require('../security/diagnostics.ts');
const { validateProviderLogicalPath } = require('../security/path-policy.ts');
const { ResourcePolicy } = require('../security/resource-policy.ts');
const { projectProviderForBrowser } = require('../security/browser-projection.ts');
const { MANDATORY_SECURITY_CHECKS, runMandatorySecurityGate } = require('../security/security-gate.ts');
const { SecretLeakDetector } = require('../../test/provider-harness/host/secret-leak-detector.ts');
const { RecordingTelemetry } = require('../../test/provider-harness/host/recording-telemetry.ts');
const { NoopTelemetry } = require('../../test/provider-harness/host/noop-telemetry.ts');

function response(body = {}, options = {}) {
  const text = JSON.stringify(body);
  return {
    status: options.status ?? 200,
    ok: (options.status ?? 200) >= 200 && (options.status ?? 200) < 300,
    redirectUrl: options.redirectUrl,
    bodyBytes: options.bodyBytes ?? Buffer.byteLength(text),
    connectedAddress: options.connectedAddress ?? '192.0.2.10',
    async json() { return body; }
  };
}

test('network mediation enforces destination, protocol, DNS/IP pinning, redirects, URL credentials, and response size', async () => {
  const dns = new Map([['printer.local', ['192.0.2.10']], ['other.local', ['198.51.100.4']]]);
  const resolver = { async resolve(hostname) { return dns.get(hostname) ?? []; } };
  const executionPolicies = [];
  const executor = { async execute(url, _init, policy) {
    executionPolicies.push(policy);
    if (url.endsWith('/redirect')) return response({}, { redirectUrl: 'https://blocked.example/next' });
    if (url.endsWith('/large')) return response({}, { bodyBytes: 1001 });
    return response({ ok: true });
  }};
  const client = new HostNetworkClient({
    allowedOrigins: ['http://printer.local'],
    allowedAddressesByHost: { 'printer.local': ['192.0.2.10'] },
    maxRedirects: 1,
    maxResponseBytes: 1000,
    maxTimeoutMs: 100
  }, executor, resolver);

  assert.equal((await client.request('http://printer.local/api')).ok, true);
  assert.deepEqual(executionPolicies[0].approvedAddresses, ['192.0.2.10']);
  assert.equal(executionPolicies[0].maxResponseBytes, 1000);
  assert.equal(executionPolicies[0].redirectMode, 'manual');
  await assert.rejects(client.request('http://other.local/api'), /destination/);
  await assert.rejects(client.request('file:///not-allowed'), /protocol/);
  await assert.rejects(client.request('http://user:pass@printer.local/api'), /credentials/);
  await assert.rejects(client.request('http://printer.local/redirect'), /destination/);
  await assert.rejects(client.request('http://printer.local/large'), /payload/);

  dns.set('printer.local', ['127.0.0.1']);
  await assert.rejects(client.request('http://printer.local/rebind'), /resolved address/);
});

test('network mediation fails closed when response size is not measured', async () => {
  const resolver = { async resolve() { return ['192.0.2.10']; } };
  const executor = { async execute() {
    return { status: 200, ok: true, bodyBytes: Number.NaN, connectedAddress: '192.0.2.10', async json() { return {}; } };
  }};
  const client = new HostNetworkClient({
    allowedOrigins: ['http://printer.local'],
    allowedAddressesByHost: { 'printer.local': ['192.0.2.10'] },
    maxRedirects: 0,
    maxResponseBytes: 1000,
    maxTimeoutMs: 100
  }, executor, resolver);
  await assert.rejects(client.request('http://printer.local/api'), /measured response size/);
});

test('network mediation binds approved address to execution and rejects connection drift', async () => {
  const resolver = { async resolve() { return ['192.0.2.10']; } };
  const executor = { async execute(_url, _init, policy) {
    assert.deepEqual(policy.approvedAddresses, ['192.0.2.10']);
    return response({}, { connectedAddress: '127.0.0.1' });
  }};
  const client = new HostNetworkClient({
    allowedOrigins: ['http://printer.local'],
    allowedAddressesByHost: { 'printer.local': ['192.0.2.10'] },
    maxRedirects: 0,
    maxResponseBytes: 1000,
    maxTimeoutMs: 100
  }, executor, resolver);
  await assert.rejects(client.request('http://printer.local/api'), /connected address/);
});

test('network mediation actively aborts a hung executor at the configured timeout', async () => {
  const resolver = { async resolve() { return ['192.0.2.10']; } };
  const executor = { async execute(_url, _init, policy) {
    return await new Promise((_resolve, reject) => {
      policy.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
  }};
  const client = new HostNetworkClient({
    allowedOrigins: ['http://printer.local'],
    allowedAddressesByHost: { 'printer.local': ['192.0.2.10'] },
    maxRedirects: 0,
    maxResponseBytes: 1000,
    maxTimeoutMs: 10
  }, executor, resolver);
  await assert.rejects(client.request('http://printer.local/api'), /timeout/);
});

test('authorization denial occurs before provider invocation even when operation is supported', async () => {
  const order = [];
  const authorization = {
    authorize(operation) { order.push(`auth:${operation}`); return false; }
  };
  const broker = new HostOperationBroker(authorization);
  let invoked = 0;
  await assert.rejects(
    broker.invoke('PRINT', { capabilitySupported: true }, () => { invoked++; return 'bad'; }),
    (error) => error instanceof SecurityDeniedError && error.code === 'AUTHORIZATION_DENIED'
  );
  assert.equal(invoked, 0);
  assert.deepEqual(order, ['auth:PRINT']);
});

test('privileged classification is host-owned and cannot be demoted by the caller', async () => {
  const decisions = [];
  const authorization = {
    authorize(operation, context) {
      decisions.push({ operation, privileged: context.privileged });
      return context.privileged !== true;
    }
  };
  const broker = new HostOperationBroker(authorization);
  let calls = 0;

  assert.equal(broker.isPrivileged('HOST_SHUTDOWN'), true);
  await assert.rejects(
    broker.invoke('HOST_SHUTDOWN', {}, () => { calls++; return 'bad'; }),
    (error) => error.code === 'AUTHORIZATION_DENIED'
  );
  assert.equal(calls, 0);
  assert.deepEqual(decisions, [{ operation: 'HOST_SHUTDOWN', privileged: true }]);
});

test('safe diagnostic serialization allowlists fields and redacts known sensitive values', () => {
  const marker = 'SYNTHETIC-I06-MARKER-7f31';
  const raw = {
    category: 'PROVIDER_ERROR',
    operation: 'snapshot',
    retryable: false,
    userSafeMessage: `request failed ${marker}`,
    diagnosticCode: 'REMOTE_500',
    headers: { privateValue: marker },
    url: `http://printer.local/?q=${marker}`,
    path: `/tmp/${marker}`,
    stack: `stack ${marker}`,
    cause: new Error(marker)
  };
  const safe = serializeProviderDiagnostic(raw, { providerInstanceId: 'p1', printerId: 'printer1', httpStatus: 500 }, [marker]);
  const detector = new SecretLeakDetector();
  detector.seed(marker);
  detector.assertClean(safe);
  assert.deepEqual(Object.keys(safe).sort(), [
    'category','diagnosticCode','httpStatus','operation','printerId','providerInstanceId','retryable','userSafeMessage'
  ].sort());
  assert.equal(safe.userSafeMessage.includes('[REDACTED]'), true);

  assert.throws(
    () => serializeProviderDiagnostic({
      category: { nested: { privateValue: marker } },
      operation: 'snapshot'
    }),
    /category/
  );
  assert.throws(
    () => serializeProviderDiagnostic({
      category: 'PROVIDER_ERROR',
      operation: { nested: marker }
    }),
    /operation/
  );
});

test('logical path policy rejects traversal, deep encoding, NUL, alternate separators, and absolute paths', () => {
  assert.equal(validateProviderLogicalPath('jobs/cube.gcode'), 'jobs/cube.gcode');
  for (const bad of [
    '../escape',
    '..\\escape',
    '%2e%2e/escape',
    '%252e%252e%252fescape',
    '%252525252e%252525252e%252525252fescape',
    'nul\0byte.gcode',
    '/absolute/path',
    'C:\\absolute\\path'
  ]) {
    assert.throws(() => validateProviderLogicalPath(bad));
  }
});

test('resource policy bounds payload, timeout, retries, and concurrency', async () => {
  const policy = new ResourcePolicy({ maxConcurrent: 1, maxPayloadBytes: 10, maxRetries: 2, maxTimeoutMs: 100 });
  policy.assertPayload(10);
  assert.throws(() => policy.assertPayload(11), /Payload/);
  policy.assertTimeout(100);
  assert.throws(() => policy.assertTimeout(101), /Timeout/);
  assert.equal(policy.canRetry(0), true);
  assert.equal(policy.canRetry(1), true);
  assert.equal(policy.canRetry(2), false);

  let release;
  const first = policy.run(() => new Promise((resolve) => { release = resolve; }));
  await assert.rejects(policy.run(async () => 'no'), /Concurrency/);
  release('yes');
  assert.equal(await first, 'yes');
});

test('telemetry is optional and structured without altering functional result', async () => {
  const run = async (telemetry) => {
    const broker = new HostOperationBroker({ authorize() { return true; } }, [], telemetry);
    return broker.invoke('PRINT', { printerId: 'printer1' }, () => 42);
  };
  const recording = new RecordingTelemetry();
  const noop = new NoopTelemetry();
  assert.equal(await run(recording), 42);
  assert.equal(await run(noop), 42);

  const record = recording.all()[0];
  assert.equal(record.name, 'security.authorization');
  for (const key of ['service','component','domain','operation','privileged','allowed']) {
    assert.ok(Object.prototype.hasOwnProperty.call(record.attributes, key));
  }
});

test('telemetry failure is isolated from authorization and provider invocation semantics', async () => {
  let allowedInvocations = 0;
  const throwingTelemetry = { event() { throw new Error('telemetry unavailable'); } };

  const allowedBroker = new HostOperationBroker(
    { authorize() { return true; } },
    [],
    throwingTelemetry
  );
  assert.equal(
    await allowedBroker.invoke('PRINT', {}, () => { allowedInvocations++; return 42; }),
    42
  );
  assert.equal(allowedInvocations, 1);

  let deniedInvocations = 0;
  const deniedBroker = new HostOperationBroker(
    { authorize() { return false; } },
    [],
    throwingTelemetry
  );
  await assert.rejects(
    deniedBroker.invoke('PRINT', {}, () => { deniedInvocations++; }),
    (error) => error instanceof SecurityDeniedError && error.code === 'AUTHORIZATION_DENIED'
  );
  assert.equal(deniedInvocations, 0);
});

test('browser projection drops arbitrary provider metadata, constraints, and diagnostic reason strings', () => {
  const marker = 'PRIVATE-BROWSER-MARKER';
  const snapshot = {
    identity: { providerId:'octoprint', providerInstanceId:'p1', displayName:'OctoPrint', providerVersion:'2.0.0', implementationVersion:'revival' },
    capabilitiesRevision:1,
    capabilities:[{ id:'PRINT', supported:true, constraints:{ privateValue:marker } }],
    availability:[{ capabilityId:'PRINT', available:true, reason:marker, observedAt:1, capabilitiesRevision:1 }],
    state:{ printerId:'printer1', connection:'CONNECTED', operation:'IDLE', capabilitiesRevision:1, observedAt:1 },
    health:{ reachable:true, authenticated:true, transportConnected:true, retrying:false, degraded:false, reason:marker, observedAt:1 },
    connector:{ id:'serial0', family:'SERIAL', connected:true, displayName:marker, capabilities:[marker] },
    storages:[],
    files:[{ storageId:'local', path:'cube.gcode', name:'cube.gcode', metadata:{ privateValue:marker } }],
    endpoint:'http://printer.local',
    privateValue:marker
  };
  const projected = projectProviderForBrowser(snapshot);
  const serialized = JSON.stringify(projected);
  assert.equal(serialized.includes('printer.local'), false);
  assert.equal(serialized.includes(marker), false);
});

test('mandatory Security Gate runs every host-selected check despite provider bypass request', async () => {
  const ran = [];
  const checks = {};
  for (const name of MANDATORY_SECURITY_CHECKS) checks[name] = () => { ran.push(name); };

  const report = await runMandatorySecurityGate(checks, {
    skipSecurityGate: true,
    disabledSecurityChecks: [...MANDATORY_SECURITY_CHECKS],
    securityMode: 'off'
  });

  assert.equal(report.bypassRequested, true);
  assert.equal(report.passed, false);
  assert.deepEqual(ran, [...MANDATORY_SECURITY_CHECKS]);
});

test('mandatory Security Gate fails closed when a host security check is missing', async () => {
  const checks = {};
  for (const name of MANDATORY_SECURITY_CHECKS.slice(1)) checks[name] = () => {};
  const report = await runMandatorySecurityGate(checks);
  assert.equal(report.passed, false);
  assert.equal(report.results.find((result) => result.name === 'secret-safety').passed, false);
});

test('mandatory Security Gate reports adversarial check failure and continues remaining checks', async () => {
  const ran = [];
  const checks = {};
  for (const name of MANDATORY_SECURITY_CHECKS) {
    checks[name] = () => {
      ran.push(name);
      if (name === 'network-mediation') throw new Error('adversarial denial proof failed');
    };
  }
  const report = await runMandatorySecurityGate(checks);
  assert.equal(report.passed, false);
  assert.equal(ran.length, MANDATORY_SECURITY_CHECKS.length);
  assert.equal(report.results.find((result) => result.name === 'network-mediation').passed, false);
});

test('OctoPrint provider source has no direct fetch or node HTTP networking fallback', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'providers', 'octoprint', 'provider.ts'), 'utf8');
  assert.equal(/\bfetch\s*\(/.test(source), false);
  assert.equal(/node:(?:http|https)/.test(source), false);
  assert.equal(/new FetchTransport/.test(source), false);
});

test('security artifacts remain clean when synthetic sensitive marker is present only in raw input', () => {
  const marker = 'SYNTHETIC-I06-MARKER-a29c';
  const detector = new SecretLeakDetector();
  detector.seed(marker);

  const artifacts = {
    state: { operation: 'IDLE' },
    event: { schemaVersion: 1, eventId: 'e1', payload: { state: 'IDLE' } },
    diagnostic: serializeProviderDiagnostic({
      category: 'DATA_INVALID',
      operation: 'parse',
      retryable: false,
      userSafeMessage: `bad input ${marker}`,
      raw: { privateValue: marker }
    }, {}, [marker]),
    telemetry: { name: 'security.authorization', attributes: { operation: 'PRINT', allowed: false } },
    report: { gate: 'MANDATORY_SECURITY', passed: true }
  };
  detector.assertClean(artifacts);
});
