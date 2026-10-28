export interface AuthorizationService {
  authorize(operation: string, context: Record<string, unknown>): boolean;
}

export interface TelemetrySink {
  event(name: string, attributes?: Record<string, unknown>): void;
}

export class SecurityDeniedError extends Error {
  readonly code: string;
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

export class HostOperationBroker {
  private readonly authorization: AuthorizationService;
  private readonly standardOperations: Set<string>;
  private readonly privilegedOperations: Set<string>;
  private readonly telemetry?: TelemetrySink;

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
    const allowed = this.authorization.authorize(operation, authorizationContext);

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

  isPrivileged(operation: string): boolean {
    return this.privilegedOperations.has(operation);
  }

  isKnown(operation: string): boolean {
    return this.privilegedOperations.has(operation) || this.standardOperations.has(operation);
  }
}
