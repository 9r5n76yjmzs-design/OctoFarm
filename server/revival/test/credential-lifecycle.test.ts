const assert = require('node:assert/strict');
const { test } = require('node:test');
const { OctoPrintProvider, OctoPrintProviderError } = require('../providers/octoprint/provider.ts');
const { FakeCredentialAccessor } = require('../../test/provider-harness/host/fake-credential-accessor.ts');
const { SecretLeakDetector } = require('../../test/provider-harness/host/secret-leak-detector.ts');

class CredentialAwareTransport {
  private accepted: string;
  readonly seenCredentials: string[] = [];

  constructor(accepted: string) {
    this.accepted = accepted;
  }

  accept(credential: string): void {
    this.accepted = credential;
    this.seenCredentials.length = 0;
  }

  async request(url: string, init: { headers?: Record<string, string> } = {}) {
    const credential = String(init.headers?.['X-Api-Key'] ?? '');
    this.seenCredentials.push(credential);

    if (credential !== this.accepted) {
      return { status: 401, ok: false, async json() { return {}; } };
    }

    const path = new URL(url).pathname;
    if (path === '/api/version') {
      return {
        status: 200,
        ok: true,
        async json() {
          return { api: '0.1', server: '1.9.3', text: 'synthetic' };
        }
      };
    }
    if (path === '/api/connection') {
      return {
        status: 200,
        ok: true,
        async json() {
          return { current: { state: 'Operational', port: '/dev/ttyUSB0' } };
        }
      };
    }
    if (path === '/api/files') {
      return {
        status: 200,
        ok: true,
        async json() {
          return { files: [] };
        }
      };
    }
    return { status: 404, ok: false, async json() { return {}; } };
  }
}

test('AUTH-004 authentication challenge refreshes to a newer credential revision exactly once', async () => {
  const oldCredential = 'synthetic-old-credential';
  const newCredential = 'synthetic-new-credential';
  const credentials = new FakeCredentialAccessor();
  credentials.seed('provider-1', 'octoprint-api', oldCredential, 1);
  credentials.queueRefresh('provider-1', 'octoprint-api', newCredential, 2);

  const transport = new CredentialAwareTransport(newCredential);
  const provider = new OctoPrintProvider(
    'http://printer.local',
    'provider-1',
    'printer-1',
    transport,
    credentials,
    () => 1000
  );

  const value = await provider.snapshot();

  assert.equal(value.health.authenticated, true);
  assert.equal(provider.health().authenticated, true);
  assert.deepEqual(transport.seenCredentials.slice(0, 2), [oldCredential, newCredential]);
  assert.equal(
    credentials.audit().some((record) => record.action === 'refresh' && record.revision === 2),
    true
  );
});

test('AUTH-005 proactive rotation is picked up without restarting the provider', async () => {
  const firstCredential = 'synthetic-first-credential';
  const rotatedCredential = 'synthetic-rotated-credential';
  const credentials = new FakeCredentialAccessor();
  credentials.seed('provider-1', 'octoprint-api', firstCredential, 1);

  const firstTransport = new CredentialAwareTransport(firstCredential);
  const provider = new OctoPrintProvider(
    'http://printer.local',
    'provider-1',
    'printer-1',
    firstTransport,
    credentials,
    () => 1000
  );

  await provider.snapshot();
  credentials.rotate('provider-1', 'octoprint-api', rotatedCredential, 2);

  firstTransport.accept(rotatedCredential);
  const second = await provider.snapshot();

  assert.equal(second.health.authenticated, true);
  assert.equal(firstTransport.seenCredentials.every((value) => value === rotatedCredential), true);
});

test('AUTH-005 revocation fails closed with normalized authentication health/error and no secret leakage', async () => {
  const secret = 'synthetic-revoked-credential';
  const credentials = new FakeCredentialAccessor();
  credentials.seed('provider-1', 'octoprint-api', secret, 1);
  credentials.revoke('provider-1', 'octoprint-api');

  const provider = new OctoPrintProvider(
    'http://printer.local',
    'provider-1',
    'printer-1',
    new CredentialAwareTransport(secret),
    credentials,
    () => 1000
  );

  let captured;
  try {
    await provider.snapshot();
  } catch (error) {
    captured = error;
  }

  assert.equal(captured instanceof OctoPrintProviderError, true);
  assert.equal(captured.category, 'AUTHENTICATION');
  assert.equal(provider.health().authenticated, false);

  const detector = new SecretLeakDetector();
  detector.seed(secret);
  detector.assertClean({
    error: captured,
    health: provider.health(),
    audit: credentials.audit()
  });
});

test('failed refresh does not loop and does not expose the rejected credential', async () => {
  const secret = 'synthetic-stale-credential';
  const credentials = new FakeCredentialAccessor();
  credentials.seed('provider-1', 'octoprint-api', secret, 1);

  const transport = new CredentialAwareTransport('different-credential');
  const provider = new OctoPrintProvider(
    'http://printer.local',
    'provider-1',
    'printer-1',
    transport,
    credentials,
    () => 1000
  );

  await assert.rejects(
    provider.snapshot(),
    (error: any) =>
      error instanceof OctoPrintProviderError &&
      error.category === 'AUTHENTICATION'
  );

  assert.equal(transport.seenCredentials.length, 1);
  const detector = new SecretLeakDetector();
  detector.seed(secret);
  detector.assertClean({
    health: provider.health(),
    audit: credentials.audit()
  });
});
