/**
 * CLI fixture verification entrypoint; validates all fixture manifests and exits nonzero on malformed/missing fixtures.
 * @module
 */
const path = require('node:path');
const { loadFixtureDirectory } = require('./fixture-loader.ts');

const fixtureRoot = path.join(__dirname, '..', 'fixtures');
const fixtures = loadFixtureDirectory(fixtureRoot);

if (fixtures.length === 0) {
  throw new Error('No provider-harness fixtures were discovered.');
}

process.stdout.write(
  `Validated ${fixtures.length} provider-harness fixture(s): ${fixtures
    .map((fixture: { id: string }) => fixture.id)
    .join(', ')}\n`
);
