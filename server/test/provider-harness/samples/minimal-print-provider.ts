/**
 * Smallest provider contract example: PRINT only, with no provider-specific security exceptions.
 * @module
 */
type Capability = {
  id: string;
  supported: boolean;
  version?: string;
  constraints?: Record<string, unknown>;
};

type ProviderIdentity = {
  providerId: string;
  providerInstanceId: string;
  displayName: string;
  providerVersion: string;
  implementationVersion: string;
  protocolFamily?: string;
  protocolVersion?: string;
};

type PrinterState = {
  printerId: string;
  connection: string;
  operation: string;
  capabilitiesRevision: number;
  observedAt: number;
};

type ProviderHealth = {
  reachable: boolean;
  authenticated: boolean;
  transportConnected: boolean;
  retrying: boolean;
  degraded: boolean;
  observedAt: number;
};

/**
 * Demonstrates a provider whose only supported capability is PRINT.
 */
class MinimalPrintProvider {
  private initialized = false;
  private connected = false;
  private terminal = false;
  private prints = 0;

  /**
   * Declares contract version and PRINT support.
   * @returns Provider declaration.
   */
  declaration() {
    return {
      contractVersion: '0.1',
      capabilities: ['PRINT']
    };
  }

  /**
   * Describes the implementation and instance without native dependencies.
   * @returns Provider identity.
   */
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

  /**
   * Declares only PRINT support.
   * @returns Capability list.
   */
  capabilities(): Capability[] {
    return [{ id: 'PRINT', supported: true }];
  }

  /**
   * Reports normalized connection and idle/unavailable printer state.
   * @returns Printer state observation.
   */
  state(): PrinterState {
    return {
      printerId: 'minimal-printer-1',
      connection: this.connected ? 'CONNECTED' : 'DISCONNECTED',
      operation: this.connected ? 'IDLE' : 'UNAVAILABLE',
      capabilitiesRevision: 1,
      observedAt: 1
    };
  }

  /**
   * Reports provider reachability and authentication independent of printer operation.
   * @returns Provider health.
   */
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

  /**
   * Initializes the provider before connection.
   * @returns Nothing.
   * @throws Error after shutdown.
   */
  initialize(): void {
    if (this.terminal) throw new Error('provider is shutdown');
    this.initialized = true;
  }

  /**
   * Transitions to connected after initialization.
   * @returns Nothing.
   * @throws Error before initialize or after shutdown.
   */
  connect(): void {
    if (this.terminal) throw new Error('provider is shutdown');
    if (!this.initialized) throw new Error('provider is not initialized');
    this.connected = true;
  }

  /**
   * Marks the provider disconnected without shutting it down.
   * @returns Nothing.
   */
  disconnect(): void {
    this.connected = false;
  }

  /**
   * Offers a no-op event subscription for the minimal sample.
   * @param _sink - Unused consumer callback.
   * @returns Unsubscribe function.
   * @throws Error after shutdown.
   */
  subscribe(_sink: (event: unknown) => void): () => void {
    if (this.terminal) throw new Error('provider is shutdown');
    return () => {};
  }

  /**
   * Permanently marks provider terminal and disconnected.
   * @returns Nothing.
   */
  shutdown(): void {
    this.connected = false;
    this.terminal = true;
  }

  /**
   * Simulates an accepted PRINT operation without driving hardware.
   * @returns Accepted result.
   * @throws Error when disconnected.
   */
  print(): { accepted: true } {
    if (!this.connected) throw new Error('provider is not connected');
    this.prints++;
    return { accepted: true };
  }

  /**
   * Reads how many synthetic prints were accepted.
   * @returns Print count.
   */
  printCount(): number {
    return this.prints;
  }
}

module.exports = { MinimalPrintProvider };
