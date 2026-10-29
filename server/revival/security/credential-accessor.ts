/**
 * Scoped and revisioned host credential lease contract; raw credentials are not part of normalized snapshots.
 * @module
 */
/**
 * Provider instance and credential identifier used for scoped host lookup.
 */
export interface CredentialScope {
  /**
   * Provider instance owning this credential.
   */
  providerInstanceId: string;
  /**
   * Stable logical credential identifier.
   */
  credentialId: string;
}

/**
 * Credential value and monotonically increasing lease revision; never serialize outside host transport.
 */
export interface CredentialLease {
  /**
   * Monotonic lease generation used to avoid repeated rejected credentials.
   */
  revision: number;
  /**
   * Secret credential value; must not be logged or included in browser, events or reports.
   */
  value: string;
}

/**
 * Host-managed current and revision-aware refresh methods for provider credentials.
 */
export interface CredentialAccessor {
  /**
   * Load the current host-held credential lease for this provider instance.
   * @param scope - Provider instance and credential identity.
   * @returns Current lease, synchronously or asynchronously.
   * @throws CredentialUnavailableError when revoked or absent.
   */
  current(scope: CredentialScope): Promise<CredentialLease> | CredentialLease;
  /**
   * Retrieve a potentially newer lease after authentication rejects a revision.
   * @param scope - Provider instance and credential identity.
   * @param rejectedRevision - Lease revision rejected by the provider.
   * @returns Current or refreshed lease.
   * @throws CredentialUnavailableError when unavailable.
   */
  refresh(
    scope: CredentialScope,
    rejectedRevision: number
  ): Promise<CredentialLease> | CredentialLease;
}

/**
 * Safe error for unavailable or invalid credential leases.
 */
export class CredentialUnavailableError extends Error {
  /**
   * Creates a safe credential availability error.
   * @param message - Diagnostic message without secret data.
   */
  constructor(message = 'Credential is unavailable') {
    super(message);
    this.name = 'CredentialUnavailableError';
  }
}

/**
 * Checks lease revision and nonempty credential value before use.
 * @param value - Candidate lease.
 * @returns Validated lease.
 * @throws CredentialUnavailableError for invalid or unavailable fields.
 */
export function assertCredentialLease(value: CredentialLease): CredentialLease {
  if (!value || typeof value !== 'object') {
    throw new CredentialUnavailableError('Credential lease is invalid');
  }
  if (!Number.isInteger(value.revision) || value.revision < 1) {
    throw new CredentialUnavailableError('Credential revision is invalid');
  }
  if (typeof value.value !== 'string' || value.value.length === 0) {
    throw new CredentialUnavailableError('Credential value is unavailable');
  }
  return value;
}
