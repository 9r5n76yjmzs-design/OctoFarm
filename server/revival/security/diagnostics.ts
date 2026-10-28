export interface DiagnosticContext {
  providerInstanceId?: string;
  printerId?: string;
  httpStatus?: number;
}

function redact(value: unknown, sensitiveValues: readonly string[]): unknown {
  if (typeof value !== 'string') return value;
  let output = value;
  for (const sensitive of sensitiveValues) {
    if (sensitive) output = output.split(sensitive).join('[REDACTED]');
  }
  return output;
}

export function serializeProviderDiagnostic(
  input: Record<string, unknown>,
  context: DiagnosticContext = {},
  sensitiveValues: readonly string[] = []
): Record<string, unknown> {
  const output: Record<string, unknown> = {};

  for (const key of ['category', 'operation', 'retryable', 'userSafeMessage', 'diagnosticCode'] as const) {
    if (input[key] !== undefined) output[key] = redact(input[key], sensitiveValues);
  }
  if (context.providerInstanceId) output.providerInstanceId = context.providerInstanceId;
  if (context.printerId) output.printerId = context.printerId;
  if (context.httpStatus !== undefined) output.httpStatus = context.httpStatus;

  return output;
}
