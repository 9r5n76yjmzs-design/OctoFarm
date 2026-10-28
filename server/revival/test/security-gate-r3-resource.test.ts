const assert = require('node:assert/strict');
const { test } = require('node:test');
const { ResourcePolicy } = require('../security/resource-policy.ts');

test('R3 resource policy bounds completion and retains capacity for timed-out work that remains active', async () => {
  const policy = new ResourcePolicy({
    maxConcurrent: 1,
    maxPayloadBytes: 1024,
    maxRetries: 1,
    maxTimeoutMs: 20
  });

  await assert.rejects(
    policy.run(() => new Promise(() => {})),
    /Operation timeout/
  );

  assert.equal(policy.status().active, 1);
  await assert.rejects(
    policy.run(async () => 'should-not-run'),
    /Concurrency limit/
  );
});

test('R3 resource policy returns deterministic timeout while still aborting cooperative work', async () => {
  const policy = new ResourcePolicy({
    maxConcurrent: 1,
    maxPayloadBytes: 1024,
    maxRetries: 0,
    maxTimeoutMs: 20
  });

  let observedAbort = false;
  await assert.rejects(
    policy.run((signal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        observedAbort = true;
        reject(new Error('aborted'));
      }, { once: true });
    })),
    /Operation timeout/
  );

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(observedAbort, true);
  assert.equal(policy.status().active, 0);
});
