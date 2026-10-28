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

export class HostOperationBroker {
  private readonly authorization: AuthorizationService;
  private readonly privilegedOperations: Set<string>;
  private readonly telemetry?: TelemetrySink;

  constructor(
    authorization: AuthorizationService,
    privilegedOperations: string[] = [],
    telemetry?: TelemetrySink
  ) {
    this.authorization = authorization;
    this.privilegedOperations = new Set(privilegedOperations);
    this.telemetry = telemetry;
  }

  async invoke<T>(
    operation: string,
    context: Record<string, unknown>,
    providerCall: () => Promise<T> | T,
    options: { privileged?: boolean } = {}
  ): Promise<T> {
    const allowed = this.authorization.authorize(operation, context);
    this.telemetry?.event('security.authorization', {
      service: 'octofarm-revival',
      component: 'host-security',
      domain: 'provider-operation',
      operation,
      allowed
    });

    if (!allowed) throw new SecurityDeniedError('AUTHORIZATION_DENIED', 'Operation denied by host authorization');
    if (options.privileged && !this.privilegedOperations.has(operation)) {
      throw new SecurityDeniedError('PRIVILEGED_OPERATION_DENIED', 'Privileged operation is not host-brokered');
    }
    return providerCall();
  }
}
