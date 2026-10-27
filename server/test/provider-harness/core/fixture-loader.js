const fs = require('fs');
const path = require('path');

const FIXTURE_SCHEMA_VERSION = 1;
const FIXTURE_ID_PATTERN =
  /^(?:OP|OP2|AUTH|NET|DATA|STATE|JOB|FILE|CAP|SEC|ADV|REG)-[A-Z0-9]+(?:-[A-Z0-9]+)*$/;
const REQUIREMENT_ID_PATTERN = /^OR11-REQ-\d{3}$/;
const PURPOSES = new Set(['characterization', 'contract', 'regression']);
const TOP_LEVEL_KEYS = new Set([
  'schemaVersion',
  'id',
  'purpose',
  'description',
  'requirements',
  'source',
  'tags',
  'input',
  'expected'
]);

class FixtureValidationError extends Error {
  constructor(message, fixturePath) {
    super(fixturePath ? `${fixturePath}: ${message}` : message);
    this.name = 'FixtureValidationError';
    this.fixturePath = fixturePath || null;
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assert(condition, message, fixturePath) {
  if (!condition) {
    throw new FixtureValidationError(message, fixturePath);
  }
}

function validateFixture(fixture, fixturePath = null) {
  assert(isPlainObject(fixture), 'fixture must be a JSON object', fixturePath);

  const unknownKeys = Object.keys(fixture).filter((key) => !TOP_LEVEL_KEYS.has(key));
  assert(
    unknownKeys.length === 0,
    `unknown top-level field(s): ${unknownKeys.join(', ')}`,
    fixturePath
  );

  assert(
    fixture.schemaVersion === FIXTURE_SCHEMA_VERSION,
    `schemaVersion must equal ${FIXTURE_SCHEMA_VERSION}`,
    fixturePath
  );
  assert(
    typeof fixture.id === 'string' && FIXTURE_ID_PATTERN.test(fixture.id),
    'id must be a stable fixture identifier such as REG-HARNESS-001',
    fixturePath
  );
  assert(
    PURPOSES.has(fixture.purpose),
    'purpose must be characterization, contract, or regression',
    fixturePath
  );
  assert(
    typeof fixture.description === 'string' && fixture.description.trim().length > 0,
    'description must be a non-empty string',
    fixturePath
  );

  assert(Array.isArray(fixture.requirements), 'requirements must be an array', fixturePath);
  fixture.requirements.forEach((requirement) => {
    assert(
      typeof requirement === 'string' && REQUIREMENT_ID_PATTERN.test(requirement),
      `invalid requirement identifier: ${String(requirement)}`,
      fixturePath
    );
  });
  assert(
    new Set(fixture.requirements).size === fixture.requirements.length,
    'requirements must not contain duplicates',
    fixturePath
  );

  assert(isPlainObject(fixture.source), 'source must be an object', fixturePath);
  assert(
    typeof fixture.source.kind === 'string' && fixture.source.kind.trim().length > 0,
    'source.kind must be a non-empty string',
    fixturePath
  );
  assert(
    typeof fixture.source.reference === 'string' && fixture.source.reference.trim().length > 0,
    'source.reference must be a non-empty string',
    fixturePath
  );

  assert(Array.isArray(fixture.tags), 'tags must be an array', fixturePath);
  fixture.tags.forEach((tag) => {
    assert(
      typeof tag === 'string' && tag.trim().length > 0,
      'tags must contain non-empty strings',
      fixturePath
    );
  });
  assert(
    new Set(fixture.tags).size === fixture.tags.length,
    'tags must not contain duplicates',
    fixturePath
  );

  assert(isPlainObject(fixture.input), 'input must be an object', fixturePath);
  assert(isPlainObject(fixture.expected), 'expected must be an object', fixturePath);

  return fixture;
}

function loadFixtureFile(fixturePath) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  } catch (error) {
    throw new FixtureValidationError(`unable to parse JSON: ${error.message}`, fixturePath);
  }
  return validateFixture(parsed, fixturePath);
}

function findFixtureFiles(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files = [];

  entries
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((entry) => {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        files.push(...findFixtureFiles(fullPath));
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        files.push(fullPath);
      }
    });

  return files;
}

function loadFixtureDirectory(directory) {
  const fixturesById = new Map();
  const fixtures = findFixtureFiles(directory).map((fixturePath) => {
    const fixture = loadFixtureFile(fixturePath);
    const priorPath = fixturesById.get(fixture.id);
    if (priorPath) {
      throw new FixtureValidationError(
        `duplicate fixture id ${fixture.id}; already declared by ${priorPath}`,
        fixturePath
      );
    }
    fixturesById.set(fixture.id, fixturePath);
    return fixture;
  });

  return fixtures;
}

module.exports = {
  FIXTURE_SCHEMA_VERSION,
  FixtureValidationError,
  loadFixtureDirectory,
  loadFixtureFile,
  validateFixture
};
