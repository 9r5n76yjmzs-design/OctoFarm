const assert = require('node:assert/strict');
const { SecretLeakDetector } = require('../host/secret-leak-detector.ts');
const { runMandatorySecurityGate } = require('../../../revival/security/security-gate.ts');
const { HostNetworkClient } = require('../../../revival/security/host-network.ts');
const { HostOperationBroker } = require('../../../revival/security/operation-broker.ts');
const { serializeProviderDiagnostic } = require('../../../revival/security/diagnostics.ts');
const { validateProviderLogicalPath } = require('../../../revival/security/path-policy.ts');
const { ResourcePolicy } = require('../../../revival/security/resource-policy.ts');
const { projectProviderForBrowser } = require('../../../revival/security/browser-projection.ts');

function expectThrow(callback: () => unknown): void {
  let threw = false;
  try {
    callback();
  } catch {
    threw = true;
  }
  assert.equal(threw, true);
}

async function runHostSecurityGate() {
  const checks = {
    'secret-safety': () => {
      const marker = 'I07-SENSITIVE-MARKER';
      const detector = new SecretLeakDetector();
      detector.seed(marker);
      const safe = serializeProviderDiagnostic({
        category: 'DATA_INVALID',
        operation: 'parse',
        retryable: false,
        userSafeMessage: `invalid ${marker}`,
        raw: { privateValue: marker }
      }, {}, [marker]);
      detector.assertClean(safe);
    },

    'network-mediation': async () => {
      const resolver = { async resolve() { return ['192.0.2.10']; } };
      const executor = {
        async execute(_url, _init, policy) {
          assert.deepEqual(policy.approvedAddresses, ['192.0.2.10']);
          assert.equal(policy.maxResponseBytes, 100);
          assert.equal(policy.redirectMode, 'manual');
          return {
            status: 200,
            ok: true,
            bodyBytes: 2,
            connectedAddress: '192.0.2.10',
            async json() { return {}; }
          };
        }
      };
      const network = new HostNetworkClient({
        allowedOrigins: ['http://printer.local'],
        allowedAddressesByHost: { 'printer.local': ['192.0.2.10'] },
        maxRedirects: 0,
        maxResponseBytes: 100,
        maxTimeoutMs: 100
      }, executor, resolver);

      assert.equal((await network.request('http://printer.local/api')).ok, true);
      await assert.rejects(network.request('http://blocked.local/api'));
    },

    'authorization-ordering': async () => {
      let invoked = 0;
      const broker = new HostOperationBroker({ authorize() { return false; } });
      await assert.rejects(
        broker.invoke('PRINT', { capabilitySupported: true }, () => { invoked++; })
      );
      assert.equal(invoked, 0);
    },

    'privileged-brokering': async () => {
      let invoked = 0;
      const broker = new HostOperationBroker({
        authorize(_operation: string, context: Record<string, unknown>) {
          return context.privileged !== true;
        }
      });
      assert.equal(broker.isPrivileged('HOST_SHUTDOWN'), true);
      await assert.rejects(
        broker.invoke('HOST_SHUTDOWN', {}, () => { invoked++; })
      );
      assert.equal(invoked, 0);
    },

    'diagnostic-safety': () => {
      const raw = {
        category: 'PROVIDER_ERROR',
        operation: 'snapshot',
        retryable: false,
        userSafeMessage: 'safe',
        headers: { unexpected: 'private' },
        stack: 'private'
      };
      const safe = serializeProviderDiagnostic(raw);
      assert.equal(Object.prototype.hasOwnProperty.call(safe, 'headers'), false);
      assert.equal(Object.prototype.hasOwnProperty.call(safe, 'stack'), false);
    },

    'logical-path-safety': () => {
      assert.equal(validateProviderLogicalPath('jobs/cube.gcode'), 'jobs/cube.gcode');
      expectThrow(() => validateProviderLogicalPath('../escape'));
      expectThrow(() => validateProviderLogicalPath('nul' + String.fromCharCode(0) + 'file'));
    },

    'resource-ceilings': () => {
      const policy = new ResourcePolicy({
        maxConcurrent: 1,
        maxPayloadBytes: 10,
        maxRetries: 1,
        maxTimeoutMs: 100
      });
      policy.assertPayload(10);
      expectThrow(() => policy.assertPayload(11));
      assert.equal(policy.canRetry(0), true);
      assert.equal(policy.canRetry(1), false);
    },

    'browser-credential-boundary': () => {
      const marker = 'PRIVATE-I07-MARKER';
      const snapshot = {
        identity: {
          providerId: 'sample',
          providerInstanceId: 'sample-1',
          displayName: 'Sample',
          providerVersion: '1',
          implementationVersion: '1'
        },
        capabilitiesRevision: 1,
        capabilities: [{ id: 'PRINT', supported: true, constraints: { privateValue: marker } }],
        availability: [{ capabilityId: 'PRINT', available: true, reason: marker, observedAt: 1, capabilitiesRevision: 1 }],
        state: { printerId: 'p1', connection: 'CONNECTED', operation: 'IDLE', capabilitiesRevision: 1, observedAt: 1 },
        health: { reachable: true, authenticated: true, transportConnected: true, retrying: false, degraded: false, reason: marker, observedAt: 1 },
        storages: [],
        files: [{ storageId: 'local', path: 'cube.gcode', name: 'cube.gcode', metadata: { privateValue: marker } }]
      };
      assert.equal(JSON.stringify(projectProviderForBrowser(snapshot)).includes(marker), false);
    }
  };

  return runMandatorySecurityGate(checks);
}

module.exports = { runHostSecurityGate };
