/**
 * Rejects unsafe provider-logical paths before canonical provider FileRef normalization.
 * @module
 */
import { normalizeLogicalPath } from '../core/provider-contract.ts';

const MAX_DECODE_ROUNDS = 8;

/**
 * Decodes a bounded number of times and rejects traversal, NUL and absolute paths.
 * @param value - Untrusted provider-logical path.
 * @returns Canonical relative logical path.
 * @throws Error for unsafe, malformed, deep-encoded or empty input.
 */
export function validateProviderLogicalPath(value: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error('Path is required');

  let decoded = value;
  let stable = false;
  for (let i = 0; i < MAX_DECODE_ROUNDS; i++) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      throw new Error('Path contains invalid encoding');
    }
    if (next === decoded) {
      stable = true;
      break;
    }
    decoded = next;
  }
  if (!stable) throw new Error('Path encoding exceeds normalization limit');

  if (decoded.includes(String.fromCharCode(0))) throw new Error('Path contains NUL');
  const portable = decoded.replace(/\\/g, '/');
  if (portable.startsWith('/') || /^[A-Za-z]:\//.test(portable)) throw new Error('Path must be relative');

  const parts = portable.split('/');
  if (parts.some((part) => part === '..')) throw new Error('Path traversal is forbidden');

  return normalizeLogicalPath(portable);
}
