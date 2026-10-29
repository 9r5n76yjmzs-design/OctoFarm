/**
 * Synthetic network allowlist and redirect policy spy for tests.
 * @module
 */
type NetworkPolicy = { allowedOrigins?: string[]; maxRedirects?: number };
type NetworkRecord = { url: string; allowed: boolean; reason?: string };
/**
 * Records test requests and enforces configured synthetic destinations.
 */
class PolicyNetworkClient {
  private allowedOrigins: Set<string>;
  private maxRedirects: number;
  private records: NetworkRecord[] = [];
  /**
   * Configures allowed origins and maximum redirects.
   * @param policy - Test policy.
   */
  constructor(policy: NetworkPolicy = {}) { this.allowedOrigins=new Set(policy.allowedOrigins ?? []); this.maxRedirects=policy.maxRedirects ?? 0; }
  /**
   * Approves a test destination or raises a denial.
   * @param url - Candidate URL.
   * @param redirects - Followed redirects.
   * @returns Nothing.
   * @throws Error for forbidden destination or redirect limit.
   */
  authorize(url: string, redirects = 0): void {
    let origin: string; try { origin = new URL(url).origin; } catch { this.records.push({url,allowed:false,reason:'INVALID_URL'}); throw new Error('Network policy denied invalid URL'); }
    if (redirects > this.maxRedirects) { this.records.push({url,allowed:false,reason:'REDIRECT_LIMIT'}); throw new Error('Network policy denied redirect limit'); }
    if (!this.allowedOrigins.has(origin)) { this.records.push({url,allowed:false,reason:'DESTINATION_DENIED'}); throw new Error(`Network policy denied destination: ${origin}`); }
    this.records.push({url,allowed:true});
  }
  /**
   * Returns copies of network policy decisions.
   * @returns Read-only decision list.
   */
  history(): readonly NetworkRecord[] { return this.records.map((r)=>({...r})); }
}
module.exports = { PolicyNetworkClient };
