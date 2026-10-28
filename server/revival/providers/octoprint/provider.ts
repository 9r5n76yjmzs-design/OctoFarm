import { assertProviderSnapshot } from '../../core/provider-contract.ts';
import type { ProviderHealth, ProviderIdentity, ProviderSnapshot } from '../../core/provider-contract.ts';
import {
  assertCredentialLease
} from '../../security/credential-accessor.ts';
import type {
  CredentialAccessor,
  CredentialLease,
  CredentialScope
} from '../../security/credential-accessor.ts';
import {
  availabilityFor,
  baselineCapabilities,
  negotiateIdentity,
  normalizeConnector,
  normalizeFiles,
  normalizeState
} from './normalization.ts';

export interface HttpResponseLike {
  status: number;
  ok: boolean;
  json(): Promise<unknown>;
}

export interface HttpTransport {
  request(url: string, init?: { method?: string; headers?: Record<string, string> }): Promise<HttpResponseLike>;
}

export type ProviderErrorCategory =
  | 'AUTHENTICATION'
  | 'AUTHORIZATION'
  | 'UNREACHABLE'
  | 'TRANSPORT'
  | 'PROVIDER_ERROR'
  | 'DATA_INVALID';

export class OctoPrintProviderError extends Error {
  readonly category: ProviderErrorCategory;
  readonly operation: string;
  readonly retryable: boolean;

  constructor(category: ProviderErrorCategory, operation: string, retryable: boolean, message: string) {
    super(message);
    this.name = 'OctoPrintProviderError';
    this.category = category;
    this.operation = operation;
    this.retryable = retryable;
  }
}

function statusError(status: number, operation: string): OctoPrintProviderError {
  if (status === 401) return new OctoPrintProviderError('AUTHENTICATION', operation, false, 'Provider authentication failed');
  if (status === 403) return new OctoPrintProviderError('AUTHORIZATION', operation, false, 'Provider authorization failed');
  if (status >= 500) return new OctoPrintProviderError('PROVIDER_ERROR', operation, true, 'Provider service error');
  return new OctoPrintProviderError('PROVIDER_ERROR', operation, false, `Provider request failed with status ${status}`);
}

export class OctoPrintProvider {
  private capabilitiesRevision = 1;
  private readonly endpoint: string;
  private readonly providerInstanceId: string;
  private readonly printerId: string;
  private readonly transport: HttpTransport;
  private readonly credentials: CredentialAccessor;
  private readonly now: () => number;
  private lastHealth: ProviderHealth;

  constructor(
    endpoint: string,
    providerInstanceId: string,
    printerId: string,
    transport: HttpTransport,
    credentials: CredentialAccessor,
    now: () => number = Date.now
  ) {
    if (!transport || typeof transport.request !== 'function') {
      throw new Error('Host-mediated HttpTransport is required');
    }
    if (!credentials || typeof credentials.current !== 'function' || typeof credentials.refresh !== 'function') {
      throw new Error('Host credential accessor is required');
    }
    this.endpoint = endpoint;
    this.providerInstanceId = providerInstanceId;
    this.printerId = printerId;
    this.transport = transport;
    this.credentials = credentials;
    this.now = now;
    this.lastHealth = {
      reachable: false,
      authenticated: false,
      transportConnected: false,
      retrying: false,
      degraded: false,
      observedAt: this.now()
    };
  }

  health(): ProviderHealth {
    return { ...this.lastHealth };
  }

  async snapshot(): Promise<ProviderSnapshot> {
    const observedAt = this.now();
    const initial = await this.getJson('/api/version', 'version discovery');
    const serverVersion = String(initial.server ?? 'unknown');
    const major = Number.parseInt(serverVersion.split('.')[0] ?? '0', 10);
    let nativeProbe: Record<string, unknown> | undefined;

    if (Number.isFinite(major) && major >= 2) {
      nativeProbe = await this.getJson('/api/version', 'version negotiation', {
        'X-OctoPrint-Api-Version': '2.0.0'
      });
    }

    const negotiated = negotiateIdentity(initial, nativeProbe);
    const connection = await this.getJson(
      '/api/connection',
      'connection snapshot',
      negotiated.mode === 'V2_NATIVE' ? { 'X-OctoPrint-Api-Version': '2.0.0' } : undefined
    );
    const filesPayload = await this.getJson(
      '/api/files',
      'storage snapshot',
      negotiated.mode === 'V2_NATIVE' ? { 'X-OctoPrint-Api-Version': '2.0.0' } : undefined
    );

    const identity: ProviderIdentity = {
      providerId: 'octoprint',
      providerInstanceId: this.providerInstanceId,
      displayName: 'OctoPrint',
      providerVersion: negotiated.serverVersion,
      implementationVersion: 'revival-credential-lifecycle',
      protocolFamily: 'OctoPrint',
      protocolVersion: negotiated.protocolVersion
    };

    const state = normalizeState(this.printerId, connection, this.capabilitiesRevision, observedAt);
    const capabilities = baselineCapabilities();
    const availability = availabilityFor(capabilities, state, this.capabilitiesRevision, observedAt);
    const { storages, files } = normalizeFiles(filesPayload);
    const connector = normalizeConnector(connection);

    return assertProviderSnapshot({
      identity,
      capabilitiesRevision: this.capabilitiesRevision,
      capabilities,
      availability,
      state,
      health: this.health(),
      connector,
      storages,
      files
    });
  }

  setCapabilitiesRevision(revision: number): void {
    if (!Number.isInteger(revision) || revision < this.capabilitiesRevision) {
      throw new Error('capabilitiesRevision must monotonically increase');
    }
    this.capabilitiesRevision = revision;
  }

  private credentialScope(): CredentialScope {
    return {
      providerInstanceId: this.providerInstanceId,
      credentialId: 'octoprint-api'
    };
  }

  private async getCredential(
    rejectedRevision?: number
  ): Promise<CredentialLease> {
    try {
      const lease = rejectedRevision === undefined
        ? await this.credentials.current(this.credentialScope())
        : await this.credentials.refresh(this.credentialScope(), rejectedRevision);
      return assertCredentialLease(lease);
    } catch {
      this.markHealth({ reachable: true, authenticated: false, transportConnected: true });
      throw new OctoPrintProviderError(
        'AUTHENTICATION',
        'credential access',
        false,
        'Provider credential is unavailable'
      );
    }
  }

  private async send(
    path: string,
    headers: Record<string, string> | undefined,
    lease: CredentialLease
  ): Promise<HttpResponseLike> {
    return this.transport.request(`${this.endpoint}${path}`, {
      headers: {
        ...(headers ?? {}),
        'X-Api-Key': lease.value
      }
    });
  }

  private async getJson(
    path: string,
    operation: string,
    headers?: Record<string, string>
  ): Promise<Record<string, unknown>> {
    let lease = await this.getCredential();
    let response: HttpResponseLike;

    try {
      response = await this.send(path, headers, lease);
    } catch {
      this.markHealth({ reachable: false, authenticated: false, transportConnected: false });
      throw new OctoPrintProviderError('UNREACHABLE', operation, true, 'Provider is unreachable');
    }

    if (response.status === 401) {
      this.markHealth({ reachable: true, authenticated: false, transportConnected: true });
      lease = await this.getCredential(lease.revision);
      try {
        response = await this.send(path, headers, lease);
      } catch {
        this.markHealth({ reachable: false, authenticated: false, transportConnected: false });
        throw new OctoPrintProviderError('UNREACHABLE', operation, true, 'Provider is unreachable');
      }
    }

    if (!response.ok) {
      if (response.status === 401) {
        this.markHealth({ reachable: true, authenticated: false, transportConnected: true });
      } else if (response.status === 403) {
        this.markHealth({ reachable: true, authenticated: true, transportConnected: true });
      }
      throw statusError(response.status, operation);
    }

    this.markHealth({
      reachable: true,
      authenticated: true,
      transportConnected: true,
      lastSuccessfulContact: this.now()
    });

    try {
      const value = await response.json();
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('not an object');
      }
      return value as Record<string, unknown>;
    } catch {
      throw new OctoPrintProviderError('DATA_INVALID', operation, false, 'Provider returned invalid data');
    }
  }

  private markHealth(
    update: Partial<ProviderHealth>
  ): void {
    this.lastHealth = {
      ...this.lastHealth,
      ...update,
      retrying: false,
      observedAt: this.now()
    };
  }
}
