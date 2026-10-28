class SecretLeakDetector {
  private secrets = new Set<string>();

  seed(secret: string): void {
    if (!secret) throw new Error('secret must be non-empty');
    this.secrets.add(secret);
  }

  scan(value: unknown): string[] {
    const text = this.flatten(value);
    return [...this.secrets].filter((secret) => text.includes(secret));
  }

  assertClean(value: unknown): void {
    const leaked = this.scan(value);
    if (leaked.length) throw new Error(`Synthetic secret leak detected: ${leaked.join(', ')}`);
  }

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
