/**
 * Scoped synthetic credential leasing, rotation, revocation and safe audit records.
 * @module
 */
const {
  CredentialUnavailableError,
  assertCredentialLease
} = require('../../../revival/security/credential-accessor.ts');

type CredentialRecord = {
  revision: number;
  value: string;
  revoked: boolean;
};

type AuditRecord = {
  action: 'current' | 'refresh' | 'rotate' | 'revoke';
  providerInstanceId: string;
  credentialId: string;
  revision?: number;
};

/**
 * Simulates host credential revisions without external secrets.
 */
class FakeCredentialAccessor {
  private readonly records = new Map<string, CredentialRecord>();
  private readonly auditRecords: AuditRecord[] = [];
  private readonly refreshQueue = new Map<string, { revision: number; value: string }>();

  /**
   * Seeds an active test credential lease.
   * @param providerInstanceId - Scope.
   * @param credentialId - Credential ID.
   * @param value - Synthetic secret.
   * @param revision - Generation.
   * @returns Nothing.
   */
  seed(providerInstanceId: string, credentialId: string, value: string, revision = 1): void {
    this.records.set(this.key(providerInstanceId, credentialId), {
      revision,
      value,
      revoked: false
    });
  }

  /**
   * Stages a newer credential for refresh.
   * @param providerInstanceId - Scope.
   * @param credentialId - Credential ID.
   * @param value - Next synthetic secret.
   * @param revision - Next revision.
   */
  queueRefresh(providerInstanceId: string, credentialId: string, value: string, revision: number): void {
    this.refreshQueue.set(this.key(providerInstanceId, credentialId), { value, revision });
  }

  /**
   * Replaces an active test credential.
   * @param providerInstanceId - Scope.
   * @param credentialId - Credential ID.
   * @param value - Replacement.
   * @param revision - New generation.
   */
  rotate(providerInstanceId: string, credentialId: string, value: string, revision: number): void {
    const key = this.key(providerInstanceId, credentialId);
    const current = this.records.get(key);
    if (current && revision <= current.revision) throw new Error('credential revision must increase');
    this.records.set(key, { revision, value, revoked: false });
    this.auditRecords.push({ action: 'rotate', providerInstanceId, credentialId, revision });
  }

  /**
   * Revokes the scoped credential.
   * @param providerInstanceId - Scope.
   * @param credentialId - Credential ID.
   */
  revoke(providerInstanceId: string, credentialId: string): void {
    const key = this.key(providerInstanceId, credentialId);
    const current = this.records.get(key);
    if (!current) throw new Error('credential not found');
    current.revoked = true;
    this.auditRecords.push({
      action: 'revoke',
      providerInstanceId,
      credentialId,
      revision: current.revision
    });
  }

  /**
   * Returns current lease and records an access.
   * @param scope - Provider-instance credential scope.
   * @returns Current lease.
   * @throws CredentialUnavailableError if revoked/unavailable.
   */
  current(scope: { providerInstanceId: string; credentialId: string }) {
    const record = this.requireAvailable(scope);
    this.auditRecords.push({
      action: 'current',
      providerInstanceId: scope.providerInstanceId,
      credentialId: scope.credentialId,
      revision: record.revision
    });
    return assertCredentialLease({ revision: record.revision, value: record.value });
  }

  /**
   * Returns a newer staged lease after a rejected revision.
   * @param scope - Credential scope.
   * @param rejectedRevision - Rejected generation.
   * @returns New lease.
   * @throws CredentialUnavailableError when unavailable.
   */
  refresh(
    scope: { providerInstanceId: string; credentialId: string },
    rejectedRevision: number
  ) {
    const key = this.key(scope.providerInstanceId, scope.credentialId);
    const queued = this.refreshQueue.get(key);
    if (queued) {
      if (queued.revision <= rejectedRevision) {
        throw new CredentialUnavailableError('Refreshed credential revision did not advance');
      }
      this.records.set(key, {
        revision: queued.revision,
        value: queued.value,
        revoked: false
      });
      this.refreshQueue.delete(key);
    }

    const record = this.requireAvailable(scope);
    if (record.revision <= rejectedRevision) {
      throw new CredentialUnavailableError('No newer credential is available');
    }
    this.auditRecords.push({
      action: 'refresh',
      providerInstanceId: scope.providerInstanceId,
      credentialId: scope.credentialId,
      revision: record.revision
    });
    return assertCredentialLease({ revision: record.revision, value: record.value });
  }

  /**
   * Reads credential-access audit without secret values.
   * @returns Read-only audit list.
   */
  audit(): readonly AuditRecord[] {
    return this.auditRecords.map((record) => ({ ...record }));
  }

  /**
   * Requires an active, non-revoked credential.
   * @param scope - Credential scope.
   * @returns Credential record.
   * @throws CredentialUnavailableError if unavailable.
   */
  private requireAvailable(scope: { providerInstanceId: string; credentialId: string }): CredentialRecord {
    const record = this.records.get(this.key(scope.providerInstanceId, scope.credentialId));
    if (!record || record.revoked) throw new CredentialUnavailableError();
    return record;
  }

  /**
   * Builds the test key from scope dimensions.
   * @param providerInstanceId - Instance identity.
   * @param credentialId - Credential identity.
   * @returns Map key.
   */
  private key(providerInstanceId: string, credentialId: string): string {
    return `${providerInstanceId}:${credentialId}`;
  }
}

module.exports = { FakeCredentialAccessor };
