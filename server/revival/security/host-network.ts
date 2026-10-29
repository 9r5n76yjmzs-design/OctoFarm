/**
 * Host-mediated networking with URL, DNS/IP, connected peer, redirect, header, payload and deadline policy.
 * @module
 */
/**
 * Trusted executor restrictions: approved IPs, measured response bound, manual redirects, abort.
 */
export interface HostNetworkExecutionPolicy {
  /**
   * IP addresses authorized by the host for the specific destination.
   */
  approvedAddresses: readonly string[];
  /**
   * Maximum response bytes the executor is expected to measure and enforce.
   */
  maxResponseBytes: number;
  /**
   * Requires manual redirect processing by the host policy.
   */
  redirectMode: 'manual';
  /**
   * Abort signal associated with the host's request deadline.
   */
  signal: AbortSignal;
}

/**
 * Transport response must reflect the actual connected peer and measured response bytes.
 */
export interface HostNetworkResponse {
  /**
   * HTTP status returned by trusted transport.
   */
  status: number;
  /**
   * Whether transport reports a successful HTTP status.
   */
  ok: boolean;
  /**
   * Optional redirect location for host reauthorization.
   */
  redirectUrl?: string;
  /**
   * Measured response bytes; must not be inferred solely from Content-Length.
   */
  bodyBytes: number;
  /**
   * Actual peer IP used by the transport for policy verification.
   */
  connectedAddress: string;
  /**
   * Decode the measured response body.
   * @returns Parsed JSON value.
   * @throws Error on invalid JSON or body read failure.
   */
  json(): Promise<unknown>;
}

/**
 * Trusted executor is responsible for enforcing host-selected peer and response-size bounds.
 */
export interface HostNetworkExecutor {
  /**
   * Execute only using authorized addresses and return measured response facts.
   * @param url - Host-authorized destination URL.
   * @param init - Allowed request method and headers.
   * @param policy - Host-selected peer, size, redirect and deadline constraints.
   * @returns Response with measured size and actual connected peer.
   * @throws Error on transport or policy failure.
   */
  execute(
    url: string,
    init: { method?: string; headers?: Record<string, string> } | undefined,
    policy: HostNetworkExecutionPolicy
  ): Promise<HostNetworkResponse>;
}

/**
 * Injectable DNS resolver for policy checking.
 */
export interface HostNameResolver {
  /**
   * Resolve a hostname for comparison with the host address allowlist.
   * @param hostname - Requested DNS hostname.
   * @returns Resolved IP addresses.
   * @throws Error when DNS lookup fails.
   */
  resolve(hostname: string): Promise<string[]>;
}

/**
 * Host-owned origin, approved address, protocol, redirect and resource limits.
 */
export interface HostNetworkPolicy {
  /**
   * Exact network origins authorized by the host.
   */
  allowedOrigins: string[];
  /**
   * Explicit peer IP allowlist keyed by hostname.
   */
  allowedAddressesByHost: Record<string, string[]>;
  /**
   * Maximum number of same-origin redirects.
   */
  maxRedirects: number;
  /**
   * Maximum measured response bytes.
   */
  maxResponseBytes: number;
  /**
   * Maximum request deadline in milliseconds.
   */
  maxTimeoutMs: number;
  /**
   * Optional permitted URL schemes; defaults to HTTP/HTTPS.
   */
  allowedProtocols?: string[];
}

const FORBIDDEN_REQUEST_HEADERS = new Set([
  'host',
  ':authority',
  'connection',
  'proxy-authorization',
  'proxy-authenticate',
  'transfer-encoding',
  'upgrade',
  'content-length',
  'te',
  'trailer',
  'keep-alive',
  'forwarded',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-forwarded-port',
  'x-original-url',
  'x-rewrite-url'
]);

/**
 * Rejects authority/proxy/hop-by-hop and CR/LF-bearing headers.
 * @param headers - Candidate header record.
 * @returns Allowed application headers or undefined.
 * @throws Error on invalid or forbidden headers.
 */
function sanitizeRequestHeaders(headers: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!headers) return undefined;
  const output: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const normalized = name.trim().toLowerCase();
    if (!normalized || /[\r\n]/.test(name) || /[\r\n]/.test(value)) {
      throw new Error('Network policy denied invalid request header');
    }
    if (FORBIDDEN_REQUEST_HEADERS.has(normalized)) {
      throw new Error(`Network policy denied request header: ${normalized}`);
    }
    output[name] = value;
  }
  return output;
}

/**
 * Executes provider HTTP requests through host-owned network mediation.
 */
export class HostNetworkClient {
  private readonly executor: HostNetworkExecutor;
  private readonly resolver: HostNameResolver;
  private readonly allowedOrigins: Set<string>;
  private readonly allowedAddressesByHost: Map<string, Set<string>>;
  private readonly allowedProtocols: Set<string>;
  private readonly maxRedirects: number;
  private readonly maxResponseBytes: number;
  private readonly maxTimeoutMs: number;
  private readonly records: { url: string; allowed: boolean; reason?: string }[] = [];

  /**
   * Validates network policy limits and binds executor/resolver.
   * @param policy - Host network policy.
   * @param executor - Trusted transport executor.
   * @param resolver - Host name resolver.
   * @throws Error on invalid limits.
   */
  constructor(policy: HostNetworkPolicy, executor: HostNetworkExecutor, resolver: HostNameResolver) {
    if (!Number.isInteger(policy.maxRedirects) || policy.maxRedirects < 0) {
      throw new Error('maxRedirects must be a non-negative integer');
    }
    if (!Number.isInteger(policy.maxResponseBytes) || policy.maxResponseBytes < 1) {
      throw new Error('maxResponseBytes must be a positive integer');
    }
    if (!Number.isInteger(policy.maxTimeoutMs) || policy.maxTimeoutMs < 1) {
      throw new Error('maxTimeoutMs must be a positive integer');
    }

    this.executor = executor;
    this.resolver = resolver;
    this.allowedOrigins = new Set(policy.allowedOrigins);
    this.allowedAddressesByHost = new Map(
      Object.entries(policy.allowedAddressesByHost).map(([host, addresses]) => [host, new Set(addresses)])
    );
    this.allowedProtocols = new Set(policy.allowedProtocols ?? ['http:', 'https:']);
    this.maxRedirects = policy.maxRedirects;
    this.maxResponseBytes = policy.maxResponseBytes;
    this.maxTimeoutMs = policy.maxTimeoutMs;
  }

  /**
   * Validates URL and address, bounds completion and redirects, then checks executor response.
   * @param url - Destination URL.
   * @param init - Optional method and allowed headers.
   * @returns Host executor response.
   * @throws Error for policy, timeout, peer, redirect or size denial.
   */
  async request(
    url: string,
    init: { method?: string; headers?: Record<string, string> } = {}
  ): Promise<HostNetworkResponse> {
    let current = url;

    for (let redirects = 0; ; redirects++) {
      if (redirects > this.maxRedirects) {
        this.records.push({ url: current, allowed: false, reason: 'REDIRECT_LIMIT' });
        throw new Error('Network policy denied redirect limit');
      }

      const approvedAddresses = await this.authorize(current);
      const safeInit = {
        ...init,
        headers: sanitizeRequestHeaders(init.headers)
      };
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error('Network policy request timeout'));
        }, this.maxTimeoutMs);
      });

      let response: HostNetworkResponse;
      try {
        response = await Promise.race([
          this.executor.execute(current, safeInit, {
            approvedAddresses,
            maxResponseBytes: this.maxResponseBytes,
            redirectMode: 'manual',
            signal: controller.signal
          }),
          timeout
        ]);
      } catch (error) {
        if (controller.signal.aborted) {
          this.records.push({ url: current, allowed: false, reason: 'TIMEOUT' });
          throw new Error('Network policy request timeout');
        }
        throw error;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }

      if (!approvedAddresses.includes(response.connectedAddress)) {
        this.records.push({ url: current, allowed: false, reason: 'CONNECTED_ADDRESS_DENIED' });
        throw new Error('Network policy denied connected address');
      }

      if (!Number.isFinite(response.bodyBytes) || response.bodyBytes < 0) {
        this.records.push({ url: current, allowed: false, reason: 'PAYLOAD_SIZE_UNKNOWN' });
        throw new Error('Network policy requires measured response size');
      }
      if (response.bodyBytes > this.maxResponseBytes) {
        this.records.push({ url: current, allowed: false, reason: 'PAYLOAD_LIMIT' });
        throw new Error('Network policy denied response payload limit');
      }

      if (!response.redirectUrl) return response;

      const next = new URL(response.redirectUrl, current);
      if (next.origin !== new URL(current).origin) {
        this.records.push({ url: next.toString(), allowed: false, reason: 'CROSS_ORIGIN_REDIRECT_DENIED' });
        throw new Error('Network policy denied cross-origin redirect');
      }
      current = next.toString();
    }
  }

  /**
   * Reads recorded allow/deny decisions without exposing mutable storage.
   * @returns Copy of decision history.
   */
  history() {
    return this.records.map((record) => ({ ...record }));
  }

  /**
   * Resolves and approves an endpoint before invoking trusted transport.
   * @param url - Requested URL.
   * @returns Approved resolved addresses.
   * @throws Error for invalid URL, protocol, origin, credentials or DNS result.
   */
  private async authorize(url: string): Promise<string[]> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      this.records.push({ url, allowed: false, reason: 'INVALID_URL' });
      throw new Error('Network policy denied invalid URL');
    }

    if (!this.allowedProtocols.has(parsed.protocol)) {
      this.records.push({ url, allowed: false, reason: 'PROTOCOL_DENIED' });
      throw new Error('Network policy denied protocol');
    }
    if (parsed.username || parsed.password) {
      this.records.push({ url, allowed: false, reason: 'URL_CREDENTIALS_DENIED' });
      throw new Error('Network policy denied URL credentials');
    }
    if (!this.allowedOrigins.has(parsed.origin)) {
      this.records.push({ url, allowed: false, reason: 'DESTINATION_DENIED' });
      throw new Error('Network policy denied destination');
    }

    const approved = this.allowedAddressesByHost.get(parsed.hostname);
    if (!approved || approved.size === 0) {
      this.records.push({ url, allowed: false, reason: 'DNS_POLICY_MISSING' });
      throw new Error('Network policy has no approved addresses for host');
    }

    const resolved = await this.resolver.resolve(parsed.hostname);
    if (resolved.length === 0 || resolved.some((address) => !approved.has(address))) {
      this.records.push({ url, allowed: false, reason: 'DNS_IP_DENIED' });
      throw new Error('Network policy denied resolved address');
    }

    this.records.push({ url, allowed: true });
    return [...new Set(resolved)];
  }
}
