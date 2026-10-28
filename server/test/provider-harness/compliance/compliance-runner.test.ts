const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { MinimalPrintProvider } = require('../samples/minimal-print-provider.ts');
const { runProviderCompliance } = require('./compliance-runner.ts');
const { MANDATORY_SECURITY_CHECKS } = require('../../../revival/security/security-gate.ts');

test('minimal non-OctoPrint PRINT-only provider passes core, mandatory security, and declared pack', async () => {
  const provider = new MinimalPrintProvider();
  const report = await runProviderCompliance(() => provider);

  assert.equal(report.passed, true, JSON.stringify(report, null, 2));
  assert.equal(report.providerIdentity.providerId, 'minimal-print');
  assert.equal(report.harnessVersion, 'or11-i07-v1');
  assert.deepEqual(report.capabilityPacks.map((pack) => pack.declaredCapabilities), [['PRINT']]);
  assert.equal(provider.printCount(), 1);
  assert.deepEqual(report.compatibilitySuites, []);
  assert.deepEqual(report.warnings, []);
});

test('capability selection is granular and does not infer PAUSE/RESUME/CANCEL/RESTART from PRINT', async () => {
  const report = await runProviderCompliance(() => new MinimalPrintProvider());
  assert.deepEqual(report.capabilityPacks.map((pack) => pack.declaredCapabilities), [['PRINT']]);
  for (const undeclared of ['PAUSE', 'RESUME', 'CANCEL', 'RESTART']) {
    assert.equal(report.skippedCapabilities.includes(undeclared), true);
  }
});

test('official runner owns mandatory Security Gate selection and ignores provider bypass hints', async () => {
  const report = await runProviderCompliance(() => new MinimalPrintProvider());
  assert.equal(report.security.passed, true, JSON.stringify(report.security, null, 2));
  assert.deepEqual(
    report.security.tests.map((result) => result.name),
    [...MANDATORY_SECURITY_CHECKS]
  );
  assert.equal(report.security.tests.every((result) => result.passed), true);
});

test('minimal provider sample contains no OctoPrint dependency or provider-specific branch', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'samples', 'minimal-print-provider.ts'),
    'utf8'
  ).toLowerCase();
  assert.equal(source.includes('octoprint'), false);
});

test('CI invokes the same compliance entry point used locally and does not require npm install', () => {
  const workflow = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', '..', '.github', 'workflows', 'or11-provider-compliance.yml'),
    'utf8'
  );
  assert.ok(workflow.includes('server/test/provider-harness/run-compliance.ts'));
  assert.equal(/npm\s+(?:ci|install)/.test(workflow), false);
  assert.ok(workflow.includes('node --experimental-strip-types'));
  assert.ok(workflow.includes('actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803'));
  assert.ok(workflow.includes('actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38'));
});


test('host-owned Security Gate remains deterministic across repeated compliance runs', async () => {
  const signatures = [];
  for (let i = 0; i < 5; i++) {
    const report = await runProviderCompliance(() => new MinimalPrintProvider());
    assert.equal(report.passed, true, JSON.stringify(report, null, 2));
    assert.equal(report.security.passed, true, JSON.stringify(report.security, null, 2));
    signatures.push(JSON.stringify(report.security.tests));
  }
  assert.equal(new Set(signatures).size, 1);
});
