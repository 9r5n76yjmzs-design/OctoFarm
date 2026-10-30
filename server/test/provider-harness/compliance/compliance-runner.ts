/**
 * Official provider-bound compliance selection, authorization, and sensitive-evidence enforcement.
 * @module
 */
const assert = require('node:assert/strict');
const { runHostSecurityGate } = require('./host-security-suite.ts');
const { assertProviderSnapshot } = require('../../../revival/core/provider-contract.ts');
const { HostOperationBroker } = require('../../../revival/security/operation-broker.ts');
const { SensitiveValueGuard } = require('../../../revival/security/sensitive-values.ts');
const { FakeCredentialAccessor } = require('../host/fake-credential-accessor.ts');
const { SecretLeakDetector } = require('../host/secret-leak-detector.ts');

const HARNESS_VERSION = 'or11-gate-a-v2';
const COMPLIANCE_SECRET = 'SYNTHETIC-OR11-COMPLIANCE-CREDENTIAL-7f82';
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

type ComplianceContext = {
  credentials: {
    current(scope: { providerInstanceId: string; credentialId: string }): { revision: number; value: string };
  };
  credentialScope: { providerInstanceId: string; credentialId: string };
  telemetry: { event(name: string, attributes?: Record<string, unknown>): void };
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

type ProviderFactory = (context: ComplianceContext) => ComplianceProvider;
type EvidenceRecord = { label: string; value: unknown };
type Pack = (
  provider: ComplianceProvider,
  allowedBroker: InstanceType<typeof HostOperationBroker>,
  deniedBroker: InstanceType<typeof HostOperationBroker>,
  evidence: EvidenceRecord[],
  guard: InstanceType<typeof SensitiveValueGuard>
) => Promise<ComplianceCheckResult[]>;

/**
 * Records raw provider-derived evidence before it crosses a compliance output boundary.
 * @param evidence - Complete provider evidence inventory.
 * @param label - Stable source label.
 * @param value - Provider-derived value or error.
 * @returns The original value for normal processing.
 */
function recordEvidence<T>(evidence: EvidenceRecord[], label: string, value: T): T {
  evidence.push({ label, value });
  return value;
}

/**
 * Creates a JSON-safe report copy with host redaction applied to keys and string values.
 * @param value - Candidate report data.
 * @param guard - Host-known sensitive-value guard.
 * @param seen - Cycle detector for provider-controlled structures.
 * @returns Redacted report data.
 */
function redactForReport(
  value: unknown,
  guard: InstanceType<typeof SensitiveValueGuard>,
  seen = new Set<object>()
): unknown {
  if (typeof value === 'string') return guard.redact(value);
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') return undefined;
  if (value === null || value === undefined || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (value instanceof Error) {
    return { name: guard.redact(value.name), message: guard.redact(value.message) };
  }
  if (Array.isArray(value)) {
    return Array.from({ length: value.length }, (_unused, index) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      return descriptor && 'value' in descriptor
        ? redactForReport(descriptor.value, guard, seen)
        : undefined;
    });
  }

  const output: Record<string, unknown> = {};
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!descriptor.enumerable || !('value' in descriptor)) continue;
    const nested = redactForReport(descriptor.value, guard, seen);
    if (nested !== undefined) output[guard.redact(key)] = nested;
  }
  return output;
}

/**
 * Converts one provider assertion into a result while retaining raw evidence and redacting messages.
 * @param name - Descriptive check name.
 * @param action - Assertion or provider action to execute.
 * @param evidence - Raw provider evidence inventory.
 * @param guard - Host-known sensitive-value guard.
 * @returns PASS/FAIL check result.
 */
async function capture(
  name: string,
  action: () => Promise<unknown> | unknown,
  evidence: EvidenceRecord[],
  guard: InstanceType<typeof SensitiveValueGuard>
): Promise<ComplianceCheckResult> {
  try {
    const result = await action();
    if (result !== undefined) recordEvidence(evidence, `${name}:result`, result);
    return { name, passed: true };
  } catch (error) {
    recordEvidence(evidence, `${name}:error`, error);
    return {
      name,
      passed: false,
      message: guard.redact(error instanceof Error ? error.message : String(error))
    };
  }
}

/**
 * Reads a provider value, retaining raw evidence and recording a safe failure before using a fallback.
 * @param name - Provider method label.
 * @param action - Provider value read.
 * @param fallback - Safe value used to continue the complete gate.
 * @param coreTests - Core check inventory.
 * @param evidence - Raw provider evidence inventory.
 * @param guard - Host-known sensitive-value guard.
 * @returns Provider value or safe fallback.
 */
function readProviderValue<T>(
  name: string,
  action: () => T,
  fallback: T,
  coreTests: ComplianceCheckResult[],
  evidence: EvidenceRecord[],
  guard: InstanceType<typeof SensitiveValueGuard>
): T {
  try {
    return recordEvidence(evidence, name, action());
  } catch (error) {
    recordEvidence(evidence, `${name}:error`, error);
    coreTests.push({
      name: `${name} succeeds`,
      passed: false,
      message: guard.redact(error instanceof Error ? error.message : String(error))
    });
    return fallback;
  }
}

const CAPABILITY_PACKS: Readonly<Record<string, Pack>> = Object.freeze({
  PRINT: async (provider, allowedBroker, deniedBroker, evidence, guard) => [
    await capture('PRINT denied before provider invocation without authorization', async () => {
      let invoked = 0;
      await assert.rejects(
        deniedBroker.invoke('PRINT', { capabilitySupported: true }, () => {
          invoked++;
          return provider.print?.();
        })
      );
      assert.equal(invoked, 0);
    }, evidence, guard),
    await capture('PRINT callable when declared and authorized', () => {
      const operation = provider.print;
      assert.equal(typeof operation, 'function', 'PRINT must be callable when advertised supported');
      return allowedBroker.invoke('PRINT', { capabilitySupported: true }, () => operation.call(provider));
    }, evidence, guard)
  ]
});

/**
 * Runs mandatory core and security checks plus only supported, known capability packs.
 * @param factory - Creates the provider under test.
 * @returns Versioned compliance report; fails for missing/unsupported packs and failed mandatory checks.
 */
async function runProviderCompliance(factory: ProviderFactory) {
  const detector = new SecretLeakDetector();
  detector.seed(COMPLIANCE_SECRET);
  const guard = new SensitiveValueGuard([COMPLIANCE_SECRET]);
  const credentials = new FakeCredentialAccessor();
  const credentialScope = {
    providerInstanceId: 'compliance-provider-instance',
    credentialId: 'provider-api'
  };
  credentials.seed(
    credentialScope.providerInstanceId,
    credentialScope.credentialId,
    COMPLIANCE_SECRET,
    1
  );

  const evidence: EvidenceRecord[] = [];
  const telemetryRecords: Record<string, unknown>[] = [];
  const context: ComplianceContext = {
    credentials,
    credentialScope,
    telemetry: {
      event(name: string, attributes: Record<string, unknown> = {}) {
        telemetryRecords.push({ name, attributes });
      }
    }
  };
  const coreTests: ComplianceCheckResult[] = [];
  const capabilityPacks: Record<string, unknown>[] = [];

  let provider: ComplianceProvider | undefined;
  try {
    provider = factory(context);
  } catch (error) {
    recordEvidence(evidence, 'provider factory error', error);
    coreTests.push({
      name: 'provider factory succeeds',
      passed: false,
      message: guard.redact(error instanceof Error ? error.message : String(error))
    });
  }

  const declaration: Declaration = provider
    ? readProviderValue(
      'provider declaration',
      () => provider!.declaration(),
      { contractVersion: 'unknown' },
      coreTests,
      evidence,
      guard
    )
    : { contractVersion: 'unknown' };
  const identity: Record<string, unknown> = provider
    ? readProviderValue(
      'provider identity',
      () => provider!.identity(),
      { providerId: 'unavailable', providerInstanceId: 'unavailable' },
      coreTests,
      evidence,
      guard
    )
    : { providerId: 'unavailable', providerInstanceId: 'unavailable' };
  const advertised: Capability[] = provider
    ? readProviderValue(
      'provider capabilities',
      () => provider!.capabilities(),
      [],
      coreTests,
      evidence,
      guard
    )
    : [];
  const supported = advertised.filter((capability) => capability.supported).map((capability) => capability.id);

  coreTests.push(await capture('identity is normalized', () => {
    assert.equal(typeof identity.providerId, 'string');
    assert.ok(String(identity.providerId).length > 0);
    assert.ok(String(identity.providerInstanceId).length > 0);
  }, evidence, guard));

  if (provider) {
    coreTests.push(await capture('initialize succeeds', () => provider!.initialize(), evidence, guard));

    coreTests.push(await capture('manifest hints cannot redefine normalized capability support', () => {
      if (Array.isArray(declaration.capabilities)) {
        assert.deepEqual([...declaration.capabilities].sort(), [...supported].sort());
      }
    }, evidence, guard));

    coreTests.push(await capture('every supported capability has a compliance pack', () => {
      for (const capabilityId of supported) {
        assert.equal(
          Object.prototype.hasOwnProperty.call(CAPABILITY_PACKS, capabilityId),
          true,
          `No compliance pack exists for supported capability ${capabilityId}`
        );
      }
    }, evidence, guard));

    coreTests.push(await capture('connect succeeds', () => provider!.connect(), evidence, guard));

    let unsubscribe: (() => void) | void;
    coreTests.push(await capture('subscribe is available without provider-specific event requirements', () => {
      unsubscribe = provider!.subscribe((event) => recordEvidence(evidence, 'provider event', event));
      if (unsubscribe !== undefined) assert.equal(typeof unsubscribe, 'function');
    }, evidence, guard));

    coreTests.push(await capture('state and health are independently normalized', () => {
      const state = recordEvidence(evidence, 'provider state', provider!.state());
      const health = recordEvidence(evidence, 'provider health', provider!.health());
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
    }, evidence, guard));

    const allowedBroker = new HostOperationBroker({ authorize() { return true; } }, [], context.telemetry);
    const deniedBroker = new HostOperationBroker({ authorize() { return false; } }, [], context.telemetry);
    const selectedCapabilityPacks = supported.filter((capabilityId) =>
      Object.prototype.hasOwnProperty.call(CAPABILITY_PACKS, capabilityId)
    );

    for (const capabilityId of selectedCapabilityPacks) {
      const tests = await CAPABILITY_PACKS[capabilityId](
        provider,
        allowedBroker,
        deniedBroker,
        evidence,
        guard
      );
      capabilityPacks.push({
        capabilityFamily: capabilityId === 'PRINT' ? 'JOB' : 'UNKNOWN',
        declaredCapabilities: [capabilityId],
        passed: tests.every((check) => check.passed),
        tests
      });
    }

    if (typeof unsubscribe === 'function') {
      coreTests.push(await capture('unsubscribe succeeds', () => unsubscribe?.(), evidence, guard));
    }
    coreTests.push(await capture('disconnect succeeds', () => provider!.disconnect(), evidence, guard));
    coreTests.push(await capture('shutdown succeeds', () => provider!.shutdown(), evidence, guard));
  }

  recordEvidence(evidence, 'provider telemetry', telemetryRecords);
  const providerOptions = declaration.complianceHints && typeof declaration.complianceHints === 'object'
    ? declaration.complianceHints
    : {};
  const security = await runHostSecurityGate(() => detector.assertClean(evidence), providerOptions);

  const corePassed = coreTests.every((check) => check.passed);
  const skippedCapabilities = KNOWN_CAPABILITY_PACKS.filter((capabilityId) => !supported.includes(capabilityId));

  const rawReport = {
    schemaVersion: 1,
    providerIdentity: identity,
    contractVersion: declaration.contractVersion,
    harnessVersion: HARNESS_VERSION,
    passed:
      Boolean(provider) &&
      corePassed &&
      security.passed &&
      capabilityPacks.every((pack) => pack.passed),
    core: {
      passed: corePassed,
      tests: coreTests
    },
    security: {
      passed: security.passed,
      bypassRequested: security.bypassRequested,
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

  const report = redactForReport(rawReport, guard);
  detector.assertClean(report);
  return report;
}

module.exports = { runProviderCompliance };
