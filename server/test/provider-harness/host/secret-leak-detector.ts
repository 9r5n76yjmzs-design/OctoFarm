/**
 * Canary-based secret leak detection across nested test output structures.
 * @module
 */
/**
 * Finds synthetic secret values in structured diagnostics, state, telemetry and reports.
 */
class SecretLeakDetector {
  private secrets = new Set<string>();

  /**
   * Adds a synthetic secret to the scan set.
   * @param secret - Canary value.
   * @returns Nothing.
   */
  seed(secret: string): void {
    if (!secret) throw new Error('secret must be non-empty');
    this.secrets.add(secret);
  }

  /**
   * Scans nested output for registered values.
   * @param value - Candidate output.
   * @returns Detected leak markers.
   */
  scan(value: unknown): string[] {
    const text = this.flatten(value);
    return [...this.secrets].filter((secret) => text.includes(secret));
  }

  /**
   * Fails if seeded secrets appear anywhere in output.
   * @param value - Candidate output.
   * @returns Nothing.
   * @throws Error when a leak is detected.
   */
  assertClean(value: unknown): void {
    const leaked = this.scan(value);
    if (leaked.length) throw new Error(`Synthetic secret leak detected (${leaked.length} registered value(s))`);
  }

  /**
   * Flattens nested objects with cycle protection.
   * @param value - Input data.
   * @param seen - Already visited objects.
   * @returns Searchable string.
   */
  private flatten(value: unknown, seen = new Set<object>()): string {
    if (value === null || value === undefined) return String(value);
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
    if (typeof value === 'symbol' || typeof value === 'function') return String(value);

    const objectValue = value as object;
    if (seen.has(objectValue)) return '[Circular]';
    seen.add(objectValue);

    if (value instanceof Error) {
      const parts = [value.name, value.message, value.stack ?? ''];
      for (const [key, nested] of Object.entries(value as unknown as Record<string, unknown>)) {
        parts.push(key, this.flatten(nested, seen));
      }
      return parts.join('\n');
    }

    if (Array.isArray(value)) return value.map((entry) => this.flatten(entry, seen)).join('\n');

    return Object.entries(value as Record<string, unknown>)
      .flatMap(([key, nested]) => [key, this.flatten(nested, seen)])
      .join('\n');
  }
}
module.exports = { SecretLeakDetector };
