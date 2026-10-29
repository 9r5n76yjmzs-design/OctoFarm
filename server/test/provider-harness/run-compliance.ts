/**
 * CLI entrypoint for deterministic official compliance against the minimal PRINT-only reference provider.
 * @module
 */
const { MinimalPrintProvider } = require('./samples/minimal-print-provider.ts');
const { runProviderCompliance } = require('./compliance/compliance-runner.ts');
const { formatComplianceSummary } = require('./compliance/compliance-report.ts');

/**
 * Runs host-owned compliance, selects JSON/summary/both output, and sets nonzero exit status on failure.
 * @returns Promise resolved after writing report; process exit status reflects compliance.
 */
async function main() {
  const report = await runProviderCompliance(() => new MinimalPrintProvider());
  const formatIndex = process.argv.indexOf('--format');
  const format = formatIndex >= 0 ? process.argv[formatIndex + 1] : 'both';

  if (format === 'json') {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else if (format === 'summary') {
    process.stdout.write(formatComplianceSummary(report) + '\n');
  } else {
    process.stdout.write(formatComplianceSummary(report) + '\n\n');
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  }

  process.exitCode = report.passed ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
