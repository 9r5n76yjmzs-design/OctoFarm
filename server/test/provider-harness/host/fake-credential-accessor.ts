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

class FakeCredentialAccessor {
  private readonly records = new Map<string, CredentialRecord>();
  private readonly auditRecords: AuditRecord[] = [];
  private readonly refreshQueue = new Map<string, { revision: number; value: string }>();

  seed(providerInstanceId: string, credentialId: string, value: string, revision = 1): void {
    this.records.set(this.key(providerInstanceId, credentialId), {
      revision,
      value,
      revoked: false
    });
  }

  queueRefresh(providerInstanceId: string, credentialId: string, value: string, revision: number): void {
    this.refreshQueue.set(this.key(providerInstanceId, credentialId), { value, revision });
  }

  rotate(providerInstanceId: string, credentialId: string, value: string, revision: number): void {
    const key = this.key(providerInstanceId, credentialId);
    const current = this.records.get(key);
    if (current && revision <= current.revision) throw new Error('credential revision must increase');
    this.records.set(key, { revision, value, revoked: false });
    this.auditRecords.push({ action: 'rotate', providerInstanceId, credentialId, revision });
  }

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

  audit(): readonly AuditRecord[] {
    return this.auditRecords.map((record) => ({ ...record }));
  }

  private requireAvailable(scope: { providerInstanceId: string; credentialId: string }): CredentialRecord {
    const record = this.records.get(this.key(scope.providerInstanceId, scope.credentialId));
    if (!record || record.revoked) throw new CredentialUnavailableError();
    return record;
  }

  private key(providerInstanceId: string, credentialId: string): string {
    return `${providerInstanceId}:${credentialId}`;
  }
}

module.exports = { FakeCredentialAccessor };
