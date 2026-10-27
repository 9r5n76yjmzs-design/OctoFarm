const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  FixtureValidationError,
  loadFixtureDirectory,
  loadFixtureFile,
  validateFixture
} = require('./fixture-loader');

function fixture(overrides = {}) {
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

describe('fixture loader', () => {
  test('accepts the stable fixture envelope', () => {
    expect(validateFixture(fixture())).toMatchObject({ id: 'REG-HARNESS-001' });
  });

  test('rejects unknown top-level fields', () => {
    expect(() => validateFixture(fixture({ surprise: true }))).toThrow(FixtureValidationError);
  });

  test('rejects malformed requirement identifiers', () => {
    expect(() => validateFixture(fixture({ requirements: ['OR11-REQ-5'] }))).toThrow(
      FixtureValidationError
    );
  });

  test('loads committed fixture JSON', () => {
    const fixturePath = path.join(
      __dirname,
      '..',
      'fixtures',
      'regressions',
      'REG-HARNESS-001.json'
    );
    expect(loadFixtureFile(fixturePath).id).toBe('REG-HARNESS-001');
  });

  test('rejects duplicate IDs across a fixture directory', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'octofarm-fixtures-'));
    const value = JSON.stringify(fixture(), null, 2);
    fs.writeFileSync(path.join(directory, 'one.json'), value);
    fs.writeFileSync(path.join(directory, 'two.json'), value);

    expect(() => loadFixtureDirectory(directory)).toThrow(
      /duplicate fixture id REG-HARNESS-001/
    );
    fs.rmSync(directory, { recursive: true, force: true });
  });
});
