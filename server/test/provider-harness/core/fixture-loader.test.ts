/**
 * Declarative fixture schema, provenance and invalid-input coverage.
 * @module
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  FixtureValidationError,
  loadFixtureDirectory,
  loadFixtureFile,
  validateFixture
} = require('./fixture-loader.ts');

function fixture(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    id: 'REG-HARNESS-001',
    purpose: 'regression',
    description: 'Proves the fixture envelope can be loaded without harness-core changes.',
    requirements: ['OR11-REQ-005', 'OR11-REQ-040'],
    source: {
      kind: 'engineering',
      reference: 'OR-11'
    },
    tags: ['harness', 'regression'],
    input: {
      scenario: 'fixture-loader-smoke'
    },
    expected: {
      loaded: true
    },
    ...overrides
  };
}

test('fixture loader accepts the stable fixture envelope', () => {
  assert.equal(validateFixture(fixture()).id, 'REG-HARNESS-001');
});

test('fixture loader rejects unknown top-level fields', () => {
  assert.throws(() => validateFixture(fixture({ surprise: true })), FixtureValidationError);
});

test('fixture loader rejects malformed requirement identifiers', () => {
  assert.throws(
    () => validateFixture(fixture({ requirements: ['OR11-REQ-5'] })),
    FixtureValidationError
  );
});

test('fixture loader loads committed fixture JSON', () => {
  const fixturePath = path.join(
    __dirname,
    '..',
    'fixtures',
    'regressions',
    'REG-HARNESS-001.json'
  );
  assert.equal(loadFixtureFile(fixturePath).id, 'REG-HARNESS-001');
});

test('fixture loader rejects duplicate IDs across a fixture directory', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'octofarm-fixtures-'));
  const value = JSON.stringify(fixture(), null, 2);
  fs.writeFileSync(path.join(directory, 'one.json'), value);
  fs.writeFileSync(path.join(directory, 'two.json'), value);

  try {
    assert.throws(
      () => loadFixtureDirectory(directory),
      /duplicate fixture id REG-HARNESS-001/
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
