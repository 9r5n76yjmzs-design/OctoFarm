/**
 * Redacts host-known secrets, including URI and form encodings, in longest-first order.
 * @module
 */
/**
 * Creates common percent-encoded and form-encoded spellings of a secret.
 * @param value - Known sensitive string.
 * @returns Raw and encoded variants.
 */
function encodedVariants(value: string): string[] {
  const encoded = encodeURIComponent(value);
  const lowerPercent = encoded.replace(/%[0-9A-F]{2}/g, (match) => match.toLowerCase());
  const formEncoded = encoded.replace(/%20/g, '+');
  const lowerFormEncoded = lowerPercent.replace(/%20/g, '+');

  return [value, encoded, lowerPercent, formEncoded, lowerFormEncoded];
}

/**
 * Holds host-provided redaction patterns ordered to avoid partial overlap leakage.
 */
export class SensitiveValueGuard {
  private readonly values: string[];

  /**
   * Builds a deduplicated set of nonempty sensitive variants.
   * @param values - Known sensitive strings.
   * @throws Error if input is not an array.
   */
  constructor(values: readonly string[]) {
    if (!Array.isArray(values)) throw new Error('Sensitive values are required');

    this.values = [...new Set(
      values
        .filter((value) => typeof value === 'string' && value.length > 0)
        .flatMap(encodedVariants)
        .filter((value) => value.length > 0)
    )].sort((left, right) => right.length - left.length);
  }

  /**
   * Replaces registered secret spellings in output text.
   * @param value - Candidate text.
   * @returns Redacted copy.
   */
  redact(value: string): string {
    let output = value;
    for (const sensitive of this.values) {
      output = output.split(sensitive).join('[REDACTED]');
    }
    return output;
  }
}

/**
 * Requires the caller's host-issued guard before projection/serialization.
 * @param value - Unknown guard candidate.
 * @returns Validated guard.
 * @throws Error when missing or wrong type.
 */
export function requireSensitiveValueGuard(value: unknown): SensitiveValueGuard {
  if (!(value instanceof SensitiveValueGuard)) {
    throw new Error('SensitiveValueGuard is required');
  }
  return value;
}
