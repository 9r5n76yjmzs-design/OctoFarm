type ProviderIdentity = {
  providerId: string;
  providerInstanceId: string;
  displayName: string;
  providerVersion: string;
  implementationVersion: string;
  protocolFamily?: string;
  protocolVersion?: string;
};

type ComplianceCheckResult = {
  name: string;
  passed: boolean;
  message?: string;
};

type CapabilityPackResult = {
  capabilityFamily: string;
  declaredCapabilities: string[];
  passed: boolean;
  tests: ComplianceCheckResult[];
};

type ProviderComplianceReport = {
  schemaVersion: 1;
  providerIdentity: ProviderIdentity;
  contractVersion: string;
  harnessVersion: string;
  passed: boolean;
  core: {
    passed: boolean;
    tests: ComplianceCheckResult[];
  };
  security: {
    passed: boolean;
    tests: ComplianceCheckResult[];
  };
  capabilities: { id: string; supported: boolean }[];
  capabilityPacks: CapabilityPackResult[];
  skippedCapabilities: string[];
  compatibilitySuites: string[];
  warnings: string[];
};

function formatComplianceSummary(report: ProviderComplianceReport): string {
  const status = report.passed ? 'PASS' : 'FAIL';
  const packs = report.capabilityPacks.length
    ? report.capabilityPacks.map((pack) => pack.declaredCapabilities.join('+')).join(', ')
    : 'none';
  return [
    `Provider compliance: ${status}`,
    `Provider: ${report.providerIdentity.providerId}`,
    `Contract: ${report.contractVersion}`,
    `Harness: ${report.harnessVersion}`,
    `Security Gate: ${report.security.passed ? 'PASS' : 'FAIL'}`,
    `Capability packs: ${packs}`
  ].join('\n');
}

module.exports = { formatComplianceSummary };
