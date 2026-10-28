import { requireSensitiveValueGuard } from './sensitive-values.ts';
import type { SensitiveValueGuard } from './sensitive-values.ts';

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

function optionalToken(
  value: unknown,
  name: string,
  guard: SensitiveValueGuard
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !TOKEN.test(value)) {
    throw new Error(`Invalid diagnostic ${name}`);
  }
  return guard.redact(value);
}

export function serializeProviderDiagnostic(
  input: Record<string, unknown>,
  context: DiagnosticContext = {},
  sensitiveGuard: SensitiveValueGuard
): Record<string, unknown> {
  const guard = requireSensitiveValueGuard(sensitiveGuard);
  const output: Record<string, unknown> = {};

  if (input.category !== undefined) {
    if (typeof input.category !== 'string' || !CATEGORIES.has(input.category)) {
      throw new Error('Invalid diagnostic category');
    }
    output.category = input.category;
  }

  const operation = optionalToken(input.operation, 'operation', guard);
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
    output.userSafeMessage = guard.redact(input.userSafeMessage);
  }

  const diagnosticCode = optionalToken(input.diagnosticCode, 'diagnosticCode', guard);
  if (diagnosticCode !== undefined) output.diagnosticCode = diagnosticCode;

  if (context.providerInstanceId) {
    if (!TOKEN.test(context.providerInstanceId)) throw new Error('Invalid providerInstanceId');
    output.providerInstanceId = guard.redact(context.providerInstanceId);
  }
  if (context.printerId) {
    if (!TOKEN.test(context.printerId)) throw new Error('Invalid printerId');
    output.printerId = guard.redact(context.printerId);
  }
  if (context.httpStatus !== undefined) {
    if (!Number.isInteger(context.httpStatus) || context.httpStatus < 100 || context.httpStatus > 599) {
      throw new Error('Invalid httpStatus');
    }
    output.httpStatus = context.httpStatus;
  }

  return output;
}
