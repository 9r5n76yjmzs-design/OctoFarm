type NetworkPolicy = { allowedOrigins?: string[]; maxRedirects?: number };
type NetworkRecord = { url: string; allowed: boolean; reason?: string };
class PolicyNetworkClient {
  private allowedOrigins: Set<string>;
  private maxRedirects: number;
  private records: NetworkRecord[] = [];
  constructor(policy: NetworkPolicy = {}) { this.allowedOrigins=new Set(policy.allowedOrigins ?? []); this.maxRedirects=policy.maxRedirects ?? 0; }
  authorize(url: string, redirects = 0): void {
    let origin: string; try { origin = new URL(url).origin; } catch { this.records.push({url,allowed:false,reason:'INVALID_URL'}); throw new Error('Network policy denied invalid URL'); }
    if (redirects > this.maxRedirects) { this.records.push({url,allowed:false,reason:'REDIRECT_LIMIT'}); throw new Error('Network policy denied redirect limit'); }
    if (!this.allowedOrigins.has(origin)) { this.records.push({url,allowed:false,reason:'DESTINATION_DENIED'}); throw new Error(`Network policy denied destination: ${origin}`); }
    this.records.push({url,allowed:true});
  }
  history(): readonly NetworkRecord[] { return this.records.map((r)=>({...r})); }
}
module.exports = { PolicyNetworkClient };
