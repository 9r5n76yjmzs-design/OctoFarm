/**
 * Mandatory host-selected checks cannot be suppressed by provider configuration.
 * @module
 */
/**
 * Canonical host security checks evaluated for every provider.
 */
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

/**
 * Exact security check name union.
 */
export type MandatorySecurityCheck = (typeof MANDATORY_SECURITY_CHECKS)[number];

/**
 * Outcome and message of one mandatory security check.
 */
export interface SecurityCheckResult {
  /**
   * Name of the mandatory host-selected check.
   */
  name: MandatorySecurityCheck;
  /**
   * Whether the check completed without error.
   */
  passed: boolean;
  /**
   * Optional diagnostic message for a failed or missing check.
   */
  message?: string;
}

/**
 * Overall gate decision, including explicit bypass request detection.
 */
export interface SecurityGateReport {
  /**
   * Fixed report kind identifying the mandatory gate.
   */
  gate: 'MANDATORY_SECURITY';
  /**
   * True only if all checks pass and no bypass request was made.
   */
  passed: boolean;
  /**
   * Whether provider configuration attempted to disable required checks.
   */
  bypassRequested: boolean;
  /**
   * All mandatory check outcomes; one check failure does not skip the others.
   */
  results: SecurityCheckResult[];
}

/**
 * Executes every host-supplied mandatory check; missing checks and bypass requests fail compliance.
 * @param checks - Host-provided check implementations.
 * @param providerOptions - Untrusted provider configuration.
 * @returns Report with each mandatory outcome, including failures.
 */
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
