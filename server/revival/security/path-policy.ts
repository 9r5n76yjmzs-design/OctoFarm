import { normalizeLogicalPath } from '../core/provider-contract.ts';

export function validateProviderLogicalPath(value: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error('Path is required');

  let decoded = value;
  for (let i = 0; i < 3; i++) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      throw new Error('Path contains invalid encoding');
    }
    if (next === decoded) break;
    decoded = next;
  }

  if (decoded.includes('\0')) throw new Error('Path contains NUL');
  const portable = decoded.replace(/\\/g, '/');
  if (portable.startsWith('/') || /^[A-Za-z]:\//.test(portable)) throw new Error('Path must be relative');

  const parts = portable.split('/');
  if (parts.some((part) => part === '..')) throw new Error('Path traversal is forbidden');

  return normalizeLogicalPath(portable);
}
