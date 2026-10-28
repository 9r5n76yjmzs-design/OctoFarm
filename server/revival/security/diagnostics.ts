export interface DiagnosticContext {
  providerInstanceId?: string;
  printerId?: string;
  httpStatus?: number;
}

const CATEGORIES = new Set([
  'AUTHENTICATION',
  'AUTHORIZATION',
  'UNREACHABLE',
  'TIMEOUT',
  'TRANSPORT',
  'INVALID_REQUEST',
  'UNSUPPORTED',
  'CONFLICT',
  'PROVIDER_ERROR',
  'PRINTER_ERROR',
  'DATA_INVALID',
  'INTERNAL'
]);

const TOKEN = /^[A-Za-z0-9_.:-]{1,96}$/;

function redact(value: string, sensitiveValues: readonly string[]): string {
  let output = value;
  for (const sensitive of sensitiveValues) {
    if (sensitive) output = output.split(sensitive).join('[REDACTED]');
  }
  return output;
}

function optionalToken(
  value: unknown,
  name: string,
  sensitiveValues: readonly string[]
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !TOKEN.test(value)) {
    throw new Error(`Invalid diagnostic ${name}`);
  }
  return redact(value, sensitiveValues);
}

export function serializeProviderDiagnostic(
  input: Record<string, unknown>,
  context: DiagnosticContext = {},
  sensitiveValues: readonly string[] = []
): Record<string, unknown> {
  const output: Record<string, unknown> = {};

  if (input.category !== undefined) {
    if (typeof input.category !== 'string' || !CATEGORIES.has(input.category)) {
      throw new Error('Invalid diagnostic category');
    }
    output.category = input.category;
  }

  const operation = optionalToken(input.operation, 'operation', sensitiveValues);
  if (operation !== undefined) output.operation = operation;

  if (input.retryable !== undefined) {
    if (typeof input.retryable !== 'boolean') {
      throw new Error('Invalid diagnostic retryable');
    }
    output.retryable = input.retryable;
  }

  if (input.userSafeMessage !== undefined) {
    if (typeof input.userSafeMessage !== 'string' || input.userSafeMessage.length > 512) {
      throw new Error('Invalid diagnostic userSafeMessage');
    }
    output.userSafeMessage = redact(input.userSafeMessage, sensitiveValues);
  }

  const diagnosticCode = optionalToken(input.diagnosticCode, 'diagnosticCode', sensitiveValues);
  if (diagnosticCode !== undefined) output.diagnosticCode = diagnosticCode;

  if (context.providerInstanceId) {
    if (!TOKEN.test(context.providerInstanceId)) throw new Error('Invalid providerInstanceId');
    output.providerInstanceId = context.providerInstanceId;
  }
  if (context.printerId) {
    if (!TOKEN.test(context.printerId)) throw new Error('Invalid printerId');
    output.printerId = context.printerId;
  }
  if (context.httpStatus !== undefined) {
    if (!Number.isInteger(context.httpStatus) || context.httpStatus < 100 || context.httpStatus > 599) {
      throw new Error('Invalid httpStatus');
    }
    output.httpStatus = context.httpStatus;
  }

  return output;
}
