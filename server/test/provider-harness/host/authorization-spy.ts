type AuthorizationDecision = { operation: string; allowed: boolean; reason?: string };
class AuthorizationSpy {
  private decisions: AuthorizationDecision[] = [];
  allow(operation: string): void { this.decisions.push({ operation, allowed: true }); }
  deny(operation: string, reason = 'DENIED'): void { this.decisions.push({ operation, allowed: false, reason }); }
  count(operation?: string): number { return operation ? this.decisions.filter((d)=>d.operation===operation).length : this.decisions.length; }
  last(operation?: string): AuthorizationDecision | undefined {
    const matches = operation ? this.decisions.filter((d)=>d.operation===operation) : this.decisions;
    const decision = matches[matches.length - 1];
    return decision ? { ...decision } : undefined;
  }
  all(): readonly AuthorizationDecision[] { return this.decisions.map((d)=>({...d})); }
}
module.exports = { AuthorizationSpy };
