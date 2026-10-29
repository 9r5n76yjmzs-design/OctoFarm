/**
 * Host resource policy controls active work, operation timeouts, retries and measured payload limits.
 * @module
 */
/**
 * Configuration bounds for concurrent work, bytes, retries and milliseconds.
 */
export interface ResourceLimits {
  maxConcurrent: number;
  maxPayloadBytes: number;
  maxRetries: number;
  maxTimeoutMs: number;
}

/**
 * Validates a resource configuration integer.
 * @param value - Configured limit.
 * @param name - Limit name.
 * @returns Nothing.
 * @throws Error for negative or fractional values.
 */
function nonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
}

/**
 * Tracks concurrency and forces bounded completion even when an operation ignores abort.
 */
export class ResourcePolicy {
  private readonly limits: ResourceLimits;
  private active = 0;

  /**
   * Copies and validates limits.
   * @param limits - Host resource ceilings.
   * @throws Error for invalid concurrency or timeout bounds.
   */
  constructor(limits: ResourceLimits) {
    nonNegativeInteger(limits.maxConcurrent, 'maxConcurrent');
    nonNegativeInteger(limits.maxPayloadBytes, 'maxPayloadBytes');
    nonNegativeInteger(limits.maxRetries, 'maxRetries');
    nonNegativeInteger(limits.maxTimeoutMs, 'maxTimeoutMs');
    if (limits.maxConcurrent < 1) throw new Error('maxConcurrent must be at least 1');
    if (limits.maxTimeoutMs < 1) throw new Error('maxTimeoutMs must be at least 1');
    this.limits = { ...limits };
  }

  /**
   * Rejects invalid or oversized measured payloads.
   * @param bytes - Measured payload length.
   * @returns Nothing.
   * @throws Error on out-of-policy size.
   */
  assertPayload(bytes: number): void {
    if (!Number.isFinite(bytes) || bytes < 0 || bytes > this.limits.maxPayloadBytes) {
      throw new Error('Payload exceeds resource policy');
    }
  }

  /**
   * Checks requested timeout against maximum.
   * @param timeoutMs - Requested timeout.
   * @returns Nothing.
   * @throws Error for invalid or excessive timeout.
   */
  assertTimeout(timeoutMs: number): void {
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || timeoutMs > this.limits.maxTimeoutMs) {
      throw new Error('Timeout exceeds resource policy');
    }
  }

  /**
   * Checks zero-based retry index against configured retry budget.
   * @param attempt - Retry attempt index.
   * @returns True if eligible.
   */
  canRetry(attempt: number): boolean {
    return Number.isInteger(attempt) && attempt >= 0 && attempt < this.limits.maxRetries;
  }

  /**
   * Runs work with host deadline and concurrency accounting.
   * @param operation - Callback receiving cooperative AbortSignal.
   * @param timeoutMs - Deadline, defaults to configured maximum.
   * @returns Operation result.
   * @throws Error on invalid timeout, concurrency limit or timeout expiry.
   */
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

  /**
   * Observes active concurrency and current limits.
   * @returns Resource snapshot.
   */
  status() {
    return { active: this.active, ...this.limits };
  }
}
