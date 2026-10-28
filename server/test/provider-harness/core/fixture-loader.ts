const fs = require('node:fs');
const path = require('node:path');

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

type FixturePurpose = 'characterization' | 'contract' | 'regression';

interface FixtureSource {
  kind: string;
  reference: string;
}

interface Fixture {
  schemaVersion: 1;
  id: string;
  purpose: FixturePurpose;
  description: string;
  requirements: string[];
  source: FixtureSource;
  tags: string[];
  input: Record<string, unknown>;
  expected: Record<string, unknown>;
}

class FixtureValidationError extends Error {
  fixturePath: string | null;

  constructor(message: string, fixturePath: string | null = null) {
    super(fixturePath ? `${fixturePath}: ${message}` : message);
    this.name = 'FixtureValidationError';
    this.fixturePath = fixturePath;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertFixture(
  condition: unknown,
  message: string,
  fixturePath: string | null
): asserts condition {
  if (!condition) {
    throw new FixtureValidationError(message, fixturePath);
  }
}

function validateFixture(value: unknown, fixturePath: string | null = null): Fixture {
  assertFixture(isPlainObject(value), 'fixture must be a JSON object', fixturePath);

  const fixture = value as Record<string, unknown>;
  const unknownKeys = Object.keys(fixture).filter((key) => !TOP_LEVEL_KEYS.has(key));
  assertFixture(
    unknownKeys.length === 0,
    `unknown top-level field(s): ${unknownKeys.join(', ')}`,
    fixturePath
  );

  assertFixture(
    fixture.schemaVersion === FIXTURE_SCHEMA_VERSION,
    `schemaVersion must equal ${FIXTURE_SCHEMA_VERSION}`,
    fixturePath
  );
  assertFixture(
    typeof fixture.id === 'string' && FIXTURE_ID_PATTERN.test(fixture.id),
    'id must be a stable fixture identifier such as REG-HARNESS-001',
    fixturePath
  );
  assertFixture(
    typeof fixture.purpose === 'string' && PURPOSES.has(fixture.purpose),
    'purpose must be characterization, contract, or regression',
    fixturePath
  );
  assertFixture(
    typeof fixture.description === 'string' && fixture.description.trim().length > 0,
    'description must be a non-empty string',
    fixturePath
  );

  assertFixture(Array.isArray(fixture.requirements), 'requirements must be an array', fixturePath);
  fixture.requirements.forEach((requirement) => {
    assertFixture(
      typeof requirement === 'string' && REQUIREMENT_ID_PATTERN.test(requirement),
      `invalid requirement identifier: ${String(requirement)}`,
      fixturePath
    );
  });
  assertFixture(
    new Set(fixture.requirements).size === fixture.requirements.length,
    'requirements must not contain duplicates',
    fixturePath
  );

  assertFixture(isPlainObject(fixture.source), 'source must be an object', fixturePath);
  assertFixture(
    typeof fixture.source.kind === 'string' && fixture.source.kind.trim().length > 0,
    'source.kind must be a non-empty string',
    fixturePath
  );
  assertFixture(
    typeof fixture.source.reference === 'string' && fixture.source.reference.trim().length > 0,
    'source.reference must be a non-empty string',
    fixturePath
  );

  assertFixture(Array.isArray(fixture.tags), 'tags must be an array', fixturePath);
  fixture.tags.forEach((tag) => {
    assertFixture(
      typeof tag === 'string' && tag.trim().length > 0,
      'tags must contain non-empty strings',
      fixturePath
    );
  });
  assertFixture(
    new Set(fixture.tags).size === fixture.tags.length,
    'tags must not contain duplicates',
    fixturePath
  );

  assertFixture(isPlainObject(fixture.input), 'input must be an object', fixturePath);
  assertFixture(isPlainObject(fixture.expected), 'expected must be an object', fixturePath);

  return fixture as unknown as Fixture;
}

function loadFixtureFile(fixturePath: string): Fixture {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new FixtureValidationError(`unable to parse JSON: ${message}`, fixturePath);
  }
  return validateFixture(parsed, fixturePath);
}

function findFixtureFiles(directory: string): string[] {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files: string[] = [];

  entries
    .sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name))
    .forEach((entry: { isDirectory(): boolean; isFile(): boolean; name: string }) => {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        files.push(...findFixtureFiles(fullPath));
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        files.push(fullPath);
      }
    });

  return files;
}

function loadFixtureDirectory(directory: string): Fixture[] {
  const fixturesById = new Map<string, string>();
  return findFixtureFiles(directory).map((fixturePath) => {
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
}

module.exports = {
  FIXTURE_SCHEMA_VERSION,
  FixtureValidationError,
  loadFixtureDirectory,
  loadFixtureFile,
  validateFixture
};
