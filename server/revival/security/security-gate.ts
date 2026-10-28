export const MANDATORY_SECURITY_CHECKS = [
  'secret-safety',
  'network-mediation',
  'authorization-ordering',
  'privileged-brokering',
  'diagnostic-safety',
  'logical-path-safety',
  'resource-ceilings',
  'browser-credential-boundary'
] as const;

export type MandatorySecurityCheck = (typeof MANDATORY_SECURITY_CHECKS)[number];

export interface SecurityCheckResult {
  name: MandatorySecurityCheck;
  passed: boolean;
  message?: string;
}

export interface SecurityGateReport {
  gate: 'MANDATORY_SECURITY';
  passed: boolean;
  bypassRequested: boolean;
  results: SecurityCheckResult[];
}

export async function runMandatorySecurityGate(
  checks: Partial<Record<MandatorySecurityCheck, () => Promise<void> | void>>,
  providerOptions: Record<string, unknown> = {}
): Promise<SecurityGateReport> {
  const bypassRequested =
    providerOptions.skipSecurityGate === true ||
    Array.isArray(providerOptions.disabledSecurityChecks) ||
    providerOptions.securityMode === 'off';

  const results: SecurityCheckResult[] = [];
  for (const name of MANDATORY_SECURITY_CHECKS) {
    const check = checks[name];
    if (!check) {
      results.push({ name, passed: false, message: 'Mandatory security check missing' });
      continue;
    }
    try {
      await check();
      results.push({ name, passed: true });
    } catch (error) {
      results.push({
        name,
        passed: false,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return {
    gate: 'MANDATORY_SECURITY',
    passed: !bypassRequested && results.every((result) => result.passed),
    bypassRequested,
    results
  };
}
