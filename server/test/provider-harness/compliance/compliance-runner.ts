/**
 * Official host-owned provider compliance selection; core/security gates run regardless of provider hints.
 * @module
 */
const assert = require('node:assert/strict');
const { runHostSecurityGate } = require('./host-security-suite.ts');
const { assertProviderSnapshot } = require('../../../revival/core/provider-contract.ts');

const HARNESS_VERSION = 'or11-i07-v1';
const KNOWN_CAPABILITY_PACKS = ['PRINT', 'PAUSE', 'RESUME', 'CANCEL', 'RESTART'] as const;

type Capability = {
  id: string;
  supported: boolean;
};

type Declaration = {
  contractVersion: string;
  capabilities?: string[];
  complianceHints?: Record<string, unknown>;
};

/**
 * Minimal provider behavior required by the official compliance runner.
 */
type ComplianceProvider = {
  /**
   * Read the provider declaration; compliance hints are not authority.
   * @returns Provider declaration.
   */
  declaration(): Declaration;
  /**
   * Read provider and instance identity.
   * @returns Identity record.
   */
  identity(): Record<string, unknown>;
  /**
   * Read advertised normalized support.
   * @returns Capability descriptors.
   */
  capabilities(): Capability[];
  /**
   * Read normalized state.
   * @returns State record.
   */
  state(): Record<string, unknown>;
  /**
   * Read normalized health independently of state.
   * @returns Health record.
   */
  health(): Record<string, unknown>;
  /**
   * Initialize provider resources.
   * @returns Completion, synchronous or asynchronous.
   */
  initialize(): Promise<void> | void;
  /**
   * Connect provider.
   * @returns Completion, synchronous or asynchronous.
   */
  connect(): Promise<void> | void;
  /**
   * Disconnect provider.
   * @returns Completion, synchronous or asynchronous.
   */
  disconnect(): Promise<void> | void;
  /**
   * Subscribe to provider events.
   * @param sink - Event callback.
   * @returns Unsubscribe callback or undefined.
   */
  subscribe(sink: (event: unknown) => void): (() => void) | void;
  /**
   * Terminate provider lifecycle.
   * @returns Completion, synchronous or asynchronous.
   */
  shutdown(): Promise<void> | void;
  /**
   * Optional PRINT operation, required only if advertised supported.
   * @returns Provider-specific operation result.
   */
  print?(): Promise<unknown> | unknown;
};

type ComplianceCheckResult = {
  name: string;
  passed: boolean;
  message?: string;
};

type ProviderFactory = () => ComplianceProvider;
type Pack = (provider: ComplianceProvider) => Promise<ComplianceCheckResult[]>;

/**
 * Converts one synchronous or asynchronous compliance assertion into a recorded check.
 * @param name - Descriptive check name.
 * @param action - Assertion to execute.
 * @returns PASS/FAIL check result; caught errors recorded as messages.
 */
async function capture(name: string, action: () => Promise<void> | void): Promise<ComplianceCheckResult> {
  try {
    await action();
    return { name, passed: true };
  } catch (error) {
    return {
      name,
      passed: false,
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

const CAPABILITY_PACKS: Readonly<Record<string, Pack>> = Object.freeze({
  PRINT: async (provider) => [
    await capture('PRINT callable when declared and connected', async () => {
      assert.equal(typeof provider.print, 'function');
      await provider.print?.();
    })
  ]
});

/**
 * Runs mandatory core and security checks plus only supported, known capability packs.
 * @param factory - Creates the provider under test.
 * @returns Versioned compliance report; fails for missing/unsupported packs and failed mandatory checks.
 */
async function runProviderCompliance(factory: ProviderFactory) {
  const provider = factory();
  const declaration = provider.declaration();
  const identity = provider.identity();
  const coreTests: ComplianceCheckResult[] = [];
  const capabilityPacks: Record<string, unknown>[] = [];

  coreTests.push(await capture('identity is normalized', () => {
    assert.equal(typeof identity.providerId, 'string');
    assert.ok(String(identity.providerId).length > 0);
    assert.ok(String(identity.providerInstanceId).length > 0);
  }));

  coreTests.push(await capture('initialize succeeds', () => provider.initialize()));

  const advertised = provider.capabilities();
  const supported = advertised.filter((capability) => capability.supported).map((capability) => capability.id);

  coreTests.push(await capture('manifest hints cannot redefine normalized capability support', () => {
    if (Array.isArray(declaration.capabilities)) {
      assert.deepEqual([...declaration.capabilities].sort(), [...supported].sort());
    }
  }));

  coreTests.push(await capture('every supported capability has a compliance pack', () => {
    for (const capabilityId of supported) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(CAPABILITY_PACKS, capabilityId),
        true,
        `No compliance pack exists for supported capability ${capabilityId}`
      );
    }
  }));

  coreTests.push(await capture('connect succeeds', () => provider.connect()));

  coreTests.push(await capture('subscribe is available without provider-specific event requirements', () => {
    const unsubscribe = provider.subscribe(() => {});
    if (unsubscribe !== undefined) assert.equal(typeof unsubscribe, 'function');
  }));

  coreTests.push(await capture('state and health are independently normalized', () => {
    const state = provider.state();
    const health = provider.health();
    assertProviderSnapshot({
      identity,
      capabilitiesRevision: state.capabilitiesRevision,
      capabilities: advertised,
      availability: advertised.filter((capability) => capability.supported).map((capability) => ({
        capabilityId: capability.id,
        available: state.connection === 'CONNECTED',
        observedAt: state.observedAt,
        capabilitiesRevision: state.capabilitiesRevision
      })),
      state,
      health,
      storages: [],
      files: []
    });
  }));

  const security = await runHostSecurityGate();

  const selectedCapabilityPacks = supported.filter((capabilityId) =>
    Object.prototype.hasOwnProperty.call(CAPABILITY_PACKS, capabilityId)
  );

  for (const capabilityId of selectedCapabilityPacks) {
    const tests = await CAPABILITY_PACKS[capabilityId](provider);
    capabilityPacks.push({
      capabilityFamily: capabilityId === 'PRINT' ? 'JOB' : 'UNKNOWN',
      declaredCapabilities: [capabilityId],
      passed: tests.every((check) => check.passed),
      tests
    });
  }

  coreTests.push(await capture('disconnect succeeds', () => provider.disconnect()));
  coreTests.push(await capture('shutdown succeeds', () => provider.shutdown()));

  const corePassed = coreTests.every((check) => check.passed);
  const skippedCapabilities = KNOWN_CAPABILITY_PACKS.filter((capabilityId) => !supported.includes(capabilityId));

  return {
    schemaVersion: 1,
    providerIdentity: identity,
    contractVersion: declaration.contractVersion,
    harnessVersion: HARNESS_VERSION,
    passed:
      corePassed &&
      security.passed &&
      capabilityPacks.every((pack) => pack.passed),
    core: {
      passed: corePassed,
      tests: coreTests
    },
    security: {
      passed: security.passed,
      tests: security.results
    },
    capabilities: advertised.map((capability) => ({
      id: capability.id,
      supported: capability.supported
    })),
    capabilityPacks,
    skippedCapabilities: [...skippedCapabilities],
    compatibilitySuites: [],
    warnings: []
  };
}

module.exports = { runProviderCompliance };
