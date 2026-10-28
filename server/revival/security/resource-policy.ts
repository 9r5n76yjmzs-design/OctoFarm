export interface ResourceLimits {
  maxConcurrent: number;
  maxPayloadBytes: number;
  maxRetries: number;
  maxTimeoutMs: number;
}

export class ResourcePolicy {
  private readonly limits: ResourceLimits;
  private active = 0;

  constructor(limits: ResourceLimits) {
    this.limits = limits;
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
