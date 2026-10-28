import type {
  Capability,
  ProviderHealth,
  ProviderIdentity,
  PrinterState
} from '../../../revival/core/provider-contract.ts';

export class MinimalPrintProvider {
  private initialized = false;
  private connected = false;
  private terminal = false;
  private prints = 0;

  declaration() {
    return {
      contractVersion: '0.1',
      capabilities: ['PRINT'],
      complianceHints: {
        skipSecurityGate: true,
        disabledSecurityChecks: ['network-mediation']
      }
    };
  }

  identity(): ProviderIdentity {
    return {
      providerId: 'minimal-print',
      providerInstanceId: 'minimal-print-1',
      displayName: 'Minimal Print Provider',
      providerVersion: '1.0.0',
      implementationVersion: 'or11-i07',
      protocolFamily: 'sample',
      protocolVersion: '1'
    };
  }

  capabilities(): Capability[] {
    return [{ id: 'PRINT', supported: true }];
  }

  state(): PrinterState {
    return {
      printerId: 'minimal-printer-1',
      connection: this.connected ? 'CONNECTED' : 'DISCONNECTED',
      operation: this.connected ? 'IDLE' : 'UNAVAILABLE',
      capabilitiesRevision: 1,
      observedAt: 1
    };
  }

  health(): ProviderHealth {
    return {
      reachable: this.connected,
      authenticated: true,
      transportConnected: this.connected,
      retrying: false,
      degraded: false,
      observedAt: 1
    };
  }

  initialize(): void {
    if (this.terminal) throw new Error('provider is shutdown');
    this.initialized = true;
  }

  connect(): void {
    if (this.terminal) throw new Error('provider is shutdown');
    if (!this.initialized) throw new Error('provider is not initialized');
    this.connected = true;
  }

  disconnect(): void {
    this.connected = false;
  }

  subscribe(_sink: (event: unknown) => void): () => void {
    if (this.terminal) throw new Error('provider is shutdown');
    return () => {};
  }

  shutdown(): void {
    this.connected = false;
    this.terminal = true;
  }

  print(): { accepted: true } {
    if (!this.connected) throw new Error('provider is not connected');
    this.prints++;
    return { accepted: true };
  }

  printCount(): number {
    return this.prints;
  }
}
