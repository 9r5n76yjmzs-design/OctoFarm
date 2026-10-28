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
    if (limits.maxTimeoutMs < 1) throw new Error('maxTimeoutMs must be at least 1');
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

  async run<T>(
    operation: (signal: AbortSignal) => Promise<T> | T,
    timeoutMs: number = this.limits.maxTimeoutMs
  ): Promise<T> {
    this.assertTimeout(timeoutMs);
    if (timeoutMs < 1) throw new Error('Operation timeout must be at least 1 ms');
    if (this.active >= this.limits.maxConcurrent) throw new Error('Concurrency limit reached');

    this.active++;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;

    const work = Promise.resolve().then(() => operation(controller.signal));
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        reject(new Error('Operation timeout'));
        queueMicrotask(() => controller.abort());
      }, timeoutMs);
    });

    try {
      return await Promise.race([work, timeout]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);

      if (timedOut) {
        void work.finally(() => {
          this.active--;
        }).catch(() => {});
      } else {
        this.active--;
      }
    }
  }

  status() {
    return { active: this.active, ...this.limits };
  }
}
