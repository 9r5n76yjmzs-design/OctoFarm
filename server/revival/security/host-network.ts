export interface HostNetworkResponse {
  status: number;
  ok: boolean;
  redirectUrl?: string;
  bodyBytes: number;
  json(): Promise<unknown>;
}

export interface HostNetworkExecutor {
  execute(url: string, init?: { method?: string; headers?: Record<string, string> }): Promise<HostNetworkResponse>;
}

export interface HostNameResolver {
  resolve(hostname: string): Promise<string[]>;
}

export interface HostNetworkPolicy {
  allowedOrigins: string[];
  allowedAddressesByHost: Record<string, string[]>;
  maxRedirects: number;
  maxResponseBytes: number;
  allowedProtocols?: string[];
}

export class HostNetworkClient {
  private readonly executor: HostNetworkExecutor;
  private readonly resolver: HostNameResolver;
  private readonly allowedOrigins: Set<string>;
  private readonly allowedAddressesByHost: Map<string, Set<string>>;
  private readonly allowedProtocols: Set<string>;
  private readonly maxRedirects: number;
  private readonly maxResponseBytes: number;
  private readonly records: { url: string; allowed: boolean; reason?: string }[] = [];

  constructor(policy: HostNetworkPolicy, executor: HostNetworkExecutor, resolver: HostNameResolver) {
    this.executor = executor;
    this.resolver = resolver;
    this.allowedOrigins = new Set(policy.allowedOrigins);
    this.allowedAddressesByHost = new Map(
      Object.entries(policy.allowedAddressesByHost).map(([host, addresses]) => [host, new Set(addresses)])
    );
    this.allowedProtocols = new Set(policy.allowedProtocols ?? ['http:', 'https:']);
    this.maxRedirects = policy.maxRedirects;
    this.maxResponseBytes = policy.maxResponseBytes;
  }

  async request(url: string, init: { method?: string; headers?: Record<string, string> } = {}): Promise<HostNetworkResponse> {
    let current = url;
    for (let redirects = 0; ; redirects++) {
      await this.authorize(current);
      if (redirects > this.maxRedirects) {
        this.records.push({ url: current, allowed: false, reason: 'REDIRECT_LIMIT' });
        throw new Error('Network policy denied redirect limit');
      }

      const response = await this.executor.execute(current, init);
      if (!Number.isFinite(response.bodyBytes) || response.bodyBytes < 0) {
        this.records.push({ url: current, allowed: false, reason: 'PAYLOAD_SIZE_UNKNOWN' });
        throw new Error('Network policy requires measured response size');
      }
      if (response.bodyBytes > this.maxResponseBytes) {
        this.records.push({ url: current, allowed: false, reason: 'PAYLOAD_LIMIT' });
        throw new Error('Network policy denied response payload limit');
      }
      if (!response.redirectUrl) return response;
      current = new URL(response.redirectUrl, current).toString();
    }
  }

  history() {
    return this.records.map((record) => ({ ...record }));
  }

  private async authorize(url: string): Promise<void> {
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
  }
}
