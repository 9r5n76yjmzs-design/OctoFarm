/**
 * Records authorization approvals and denials for test assertions.
 * @module
 */
type AuthorizationDecision = { operation: string; allowed: boolean; reason?: string };
/**
 * Captures allowed/denied authorization decisions without a production authorization service.
 */
class AuthorizationSpy {
  private decisions: AuthorizationDecision[] = [];
  /**
   * Records an allowed operation.
   * @param operation - Logical operation name.
   * @returns Nothing.
   */
  allow(operation: string): void { this.decisions.push({ operation, allowed: true }); }
  /**
   * Records a denied operation and reason.
   * @param operation - Logical operation.
   * @param reason - Safe denial reason.
   * @returns Nothing.
   */
  deny(operation: string, reason = 'DENIED'): void { this.decisions.push({ operation, allowed: false, reason }); }
  /**
   * Counts all or operation-filtered decisions.
   * @param operation - Optional operation filter.
   * @returns Decision count.
   */
  count(operation?: string): number { return operation ? this.decisions.filter((d)=>d.operation===operation).length : this.decisions.length; }
  /**
   * Returns the latest captured authorization decision.
   * @param operation - Optional filter.
   * @returns Decision or undefined.
   */
  last(operation?: string): AuthorizationDecision | undefined {
    const matches = operation ? this.decisions.filter((d)=>d.operation===operation) : this.decisions;
    const decision = matches[matches.length - 1];
    return decision ? { ...decision } : undefined;
  }
  /**
   * Returns defensive copies of captured decisions.
   * @returns Read-only list.
   */
  all(): readonly AuthorizationDecision[] { return this.decisions.map((d)=>({...d})); }
}
module.exports = { AuthorizationSpy };
