export class SensitiveValueGuard {
  private readonly values: string[];

  constructor(values: readonly string[]) {
    if (!Array.isArray(values)) throw new Error('Sensitive values are required');
    this.values = [...new Set(
      values.filter((value) => typeof value === 'string' && value.length > 0)
    )].sort((left, right) => right.length - left.length);
  }

  redact(value: string): string {
    let output = value;
    for (const sensitive of this.values) {
      output = output.split(sensitive).join('[REDACTED]');
    }
    return output;
  }
}

export function requireSensitiveValueGuard(value: unknown): SensitiveValueGuard {
  if (!(value instanceof SensitiveValueGuard)) {
    throw new Error('SensitiveValueGuard is required');
  }
  return value;
}
