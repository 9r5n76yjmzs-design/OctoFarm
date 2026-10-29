/**
 * Host-owned authorization runs before provider invocation; caller-supplied privilege flags are ignored.
 * @module
 */
/**
 * Authorizer may be synchronous or asynchronous; only boolean decisions are accepted.
 */
export interface AuthorizationService {
  authorize(
    operation: string,
    context: Record<string, unknown>
  ): boolean | Promise<boolean>;
}

/**
 * Optional audit sink; telemetry errors never override authorization.
 */
export interface TelemetrySink {
  event(name: string, attributes?: Record<string, unknown>): void;
}

/**
 * Host denial containing a stable rejection code.
 */
export class SecurityDeniedError extends Error {
  readonly code: string;
  /**
   * Creates a safe categorized security denial.
   * @param code - Denial code.
   * @param message - Safe explanation.
   */
  constructor(code: string, message: string) {
    super(message);
    this.name = 'SecurityDeniedError';
    this.code = code;
  }
}

const DEFAULT_STANDARD_OPERATIONS = [
  'PRINT',
  'PAUSE',
  'RESUME',
  'CANCEL',
  'RESTART',
  'FILE_LIST',
  'FILE_UPLOAD',
  'FILE_SELECT',
  'FILE_DELETE',
  'FILE_MOVE',
  'FILE_COPY',
  'STORAGE_LIST',
  'STORAGE_WRITE',
  'STORAGE_REMOVE',
  'STORAGE_REFRESH'
];

const DEFAULT_PRIVILEGED_OPERATIONS = [
  'HOST_RESTART',
  'HOST_SHUTDOWN',
  'PROVIDER_SETTINGS'
];

/**
 * Registers host-owned standard and privileged operations and rejects unknown operations.
 */
export class HostOperationBroker {
  private readonly authorization: AuthorizationService;
  private readonly standardOperations: Set<string>;
  private readonly privilegedOperations: Set<string>;
  private readonly telemetry?: TelemetrySink;

  /**
   * Configures host authorizer, known operations, optional audit sink.
   * @param authorization - Host decision authority.
   * @param additionalPrivilegedOperations - Host-declared privileged operations.
   * @param telemetry - Optional observational sink.
   * @param additionalStandardOperations - Extra registered operations.
   */
  constructor(
    authorization: AuthorizationService,
    additionalPrivilegedOperations: string[] = [],
    telemetry?: TelemetrySink,
    additionalStandardOperations: string[] = []
  ) {
    this.authorization = authorization;
    this.standardOperations = new Set([
      ...DEFAULT_STANDARD_OPERATIONS,
      ...additionalStandardOperations
    ]);
    this.privilegedOperations = new Set([
      ...DEFAULT_PRIVILEGED_OPERATIONS,
      ...additionalPrivilegedOperations
    ]);
    this.telemetry = telemetry;
  }

  /**
   * Awaits authorization before calling provider; unknown, denied and non-boolean decisions fail closed.
   * @param operation - Host-registered operation name.
   * @param context - Caller context; privileged classification is overwritten.
   * @param providerCall - Deferred provider operation.
   * @returns Provider result only after authorization.
   * @throws SecurityDeniedError on unknown operation or invalid/denied authorization.
   */
  async invoke<T>(
    operation: string,
    context: Record<string, unknown>,
    providerCall: () => Promise<T> | T
  ): Promise<T> {
    const privileged = this.privilegedOperations.has(operation);
    const known = privileged || this.standardOperations.has(operation);

    if (!known) {
      try {
        this.telemetry?.event('security.authorization', {
          service: 'octofarm-revival',
          component: 'host-security',
          domain: 'provider-operation',
          operation,
          privileged: false,
          allowed: false,
          reason: 'UNKNOWN_OPERATION'
        });
      } catch {
        // Telemetry is observational.
      }
      throw new SecurityDeniedError('UNKNOWN_OPERATION', 'Operation is not registered with host security policy');
    }

    const authorizationContext = { ...context, privileged };
    const allowed = await this.authorization.authorize(operation, authorizationContext);
    if (typeof allowed !== 'boolean') {
      throw new SecurityDeniedError(
        'AUTHORIZATION_INVALID',
        'Authorization service returned a non-boolean decision'
      );
    }

    try {
      this.telemetry?.event('security.authorization', {
        service: 'octofarm-revival',
        component: 'host-security',
        domain: 'provider-operation',
        operation,
        privileged,
        allowed
      });
    } catch {
      // Telemetry is observational. Failure must not change authorization
      // semantics or provider invocation behavior.
    }

    if (!allowed) {
      throw new SecurityDeniedError('AUTHORIZATION_DENIED', 'Operation denied by host authorization');
    }
    return providerCall();
  }

  /**
   * Checks host-owned privilege classification.
   * @param operation - Operation name.
   * @returns Whether privileged.
   */
  isPrivileged(operation: string): boolean {
    return this.privilegedOperations.has(operation);
  }

  /**
   * Checks explicit host operation registration.
   * @param operation - Operation name.
   * @returns Whether registered.
   */
  isKnown(operation: string): boolean {
    return this.privilegedOperations.has(operation) || this.standardOperations.has(operation);
  }
}
