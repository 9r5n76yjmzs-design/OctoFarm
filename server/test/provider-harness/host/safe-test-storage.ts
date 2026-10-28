const path = require('node:path');
class SafeTestStorage {
  private files = new Map<string, Uint8Array>();

  normalize(logicalPath: string): string {
    if (!logicalPath || path.isAbsolute(logicalPath)) throw new Error('Storage path must be relative');
    const portable = logicalPath.replace(/\\/g, '/');
    const normalized = path.posix.normalize(portable);
    if (normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
      throw new Error('Storage path escapes root');
    }
    return normalized.replace(/^\.\//, '');
  }

  write(logicalPath: string, data: string | Uint8Array): void {
    const normalized = this.normalize(logicalPath);
    this.files.set(normalized, typeof data === 'string' ? Buffer.from(data) : new Uint8Array(data));
  }
  read(logicalPath: string): Uint8Array {
    const normalized = this.normalize(logicalPath);
    const data = this.files.get(normalized);
    if (!data) throw new Error(`Storage file not found: ${normalized}`);
    return new Uint8Array(data);
  }
  exists(logicalPath: string): boolean { return this.files.has(this.normalize(logicalPath)); }
  list(): string[] { return [...this.files.keys()].sort(); }
}
module.exports = { SafeTestStorage };
