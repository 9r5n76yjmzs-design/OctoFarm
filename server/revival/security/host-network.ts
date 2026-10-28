export interface HostNetworkResponse {
  status: number;
  ok: boolean;
  redirectUrl?: string;
  bodyBytes?: number;
  json(): Promise<unknown>;
}

export interface HostNetworkExecutor {
  execute(url: string, init?: { method?: string; headers?: Record<string, string> }): Promise<HostNetworkResponse>;
}

export interface HostNetworkPolicy {
  allowedOrigins: string[];
  maxRedirects: number;
  maxResponseBytes: number;
  allowedProtocols?: string[];
}

export class HostNetworkClient {
  private readonly executor: HostNetworkExecutor;
  private readonly allowedOrigins: Set<string>;
  private readonly allowedProtocols: Set<string>;
  private readonly maxRedirects: number;
  private readonly maxResponseBytes: number;
  private readonly records: { url: string; allowed: boolean; reason?: string }[] = [];

  constructor(policy: HostNetworkPolicy, executor: HostNetworkExecutor) {
    this.executor = executor;
    this.allowedOrigins = new Set(policy.allowedOrigins);
    this.allowedProtocols = new Set(policy.allowedProtocols ?? ['http:', 'https:']);
    this.maxRedirects = policy.maxRedirects;
    this.maxResponseBytes = policy.maxResponseBytes;
  }

  async request(url: string, init: { method?: string; headers?: Record<string, string> } = {}): Promise<HostNetworkResponse> {
    let current = url;
    for (let redirects = 0; ; redirects++) {
      this.authorize(current);
      if (redirects > this.maxRedirects) {
        this.records.push({ url: current, allowed: false, reason: 'REDIRECT_LIMIT' });
        throw new Error('Network policy denied redirect limit');
      }

      const response = await this.executor.execute(current, init);
      if (typeof response.bodyBytes === 'number' && response.bodyBytes > this.maxResponseBytes) {
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

  private authorize(url: string): void {
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
    this.records.push({ url, allowed: true });
  }
}
