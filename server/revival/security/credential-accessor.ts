export interface CredentialScope {
  providerInstanceId: string;
  credentialId: string;
}

export interface CredentialLease {
  revision: number;
  value: string;
}

export interface CredentialAccessor {
  current(scope: CredentialScope): Promise<CredentialLease> | CredentialLease;
  refresh(
    scope: CredentialScope,
    rejectedRevision: number
  ): Promise<CredentialLease> | CredentialLease;
}

export class CredentialUnavailableError extends Error {
  constructor(message = 'Credential is unavailable') {
    super(message);
    this.name = 'CredentialUnavailableError';
  }
}

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
