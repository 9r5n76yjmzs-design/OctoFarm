export interface ResourceLimits {
  maxConcurrent: number;
  maxPayloadBytes: number;
  maxRetries: number;
  maxTimeoutMs: number;
}

function nonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
}

export class ResourcePolicy {
  private readonly limits: ResourceLimits;
  private active = 0;

  constructor(limits: ResourceLimits) {
    nonNegativeInteger(limits.maxConcurrent, 'maxConcurrent');
    nonNegativeInteger(limits.maxPayloadBytes, 'maxPayloadBytes');
    nonNegativeInteger(limits.maxRetries, 'maxRetries');
    nonNegativeInteger(limits.maxTimeoutMs, 'maxTimeoutMs');
    if (limits.maxConcurrent < 1) throw new Error('maxConcurrent must be at least 1');
    this.limits = { ...limits };
  }

  assertPayload(bytes: number): void {
    if (!Number.isFinite(bytes) || bytes < 0 || bytes > this.limits.maxPayloadBytes) {
      throw new Error('Payload exceeds resource policy');
    }
  }

  assertTimeout(timeoutMs: number): void {
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || timeoutMs > this.limits.maxTimeoutMs) {
      throw new Error('Timeout exceeds resource policy');
    }
  }

  canRetry(attempt: number): boolean {
    return Number.isInteger(attempt) && attempt >= 0 && attempt < this.limits.maxRetries;
  }

  async run<T>(operation: () => Promise<T> | T): Promise<T> {
    if (this.active >= this.limits.maxConcurrent) throw new Error('Concurrency limit reached');
    this.active++;
    try {
      return await operation();
    } finally {
      this.active--;
    }
  }

  status() {
    return { active: this.active, ...this.limits };
  }
}
