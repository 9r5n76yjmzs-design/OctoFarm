/**
 * In-memory safe logical storage; never materializes paths into a host directory.
 * @module
 */
const path = require('node:path');
/**
 * Stores fixture byte content under validated logical paths.
 */
class SafeTestStorage {
  private files = new Map<string, Uint8Array>();

  /**
   * Converts an input path to a safe relative logical path.
   * @param logicalPath - Candidate path.
   * @returns Normalized key.
   * @throws Error for unsafe path.
   */
  normalize(logicalPath: string): string {
    if (!logicalPath || path.isAbsolute(logicalPath)) throw new Error('Storage path must be relative');
    const portable = logicalPath.replace(/\\/g, '/');
    const normalized = path.posix.normalize(portable);
    if (normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
      throw new Error('Storage path escapes root');
    }
    return normalized.replace(/^\.\//, '');
  }

  /**
   * Stores test bytes under a normalized path.
   * @param logicalPath - Logical file path.
   * @param data - Bytes or text.
   * @returns Nothing.
   * @throws Error for unsafe path.
   */
  write(logicalPath: string, data: string | Uint8Array): void {
    const normalized = this.normalize(logicalPath);
    this.files.set(normalized, typeof data === 'string' ? Buffer.from(data) : new Uint8Array(data));
  }
  /**
   * Reads a stored test file.
   * @param logicalPath - Logical file path.
   * @returns Stored byte copy.
   * @throws Error for missing/unsafe path.
   */
  read(logicalPath: string): Uint8Array {
    const normalized = this.normalize(logicalPath);
    const data = this.files.get(normalized);
    if (!data) throw new Error(`Storage file not found: ${normalized}`);
    return new Uint8Array(data);
  }
  /**
   * Checks existence of a normalized logical file.
   * @param logicalPath - Candidate path.
   * @returns Whether present.
   */
  exists(logicalPath: string): boolean { return this.files.has(this.normalize(logicalPath)); }
  /**
   * Lists stored paths deterministically.
   * @returns Sorted paths.
   */
  list(): string[] { return [...this.files.keys()].sort(); }
}
module.exports = { SafeTestStorage };
