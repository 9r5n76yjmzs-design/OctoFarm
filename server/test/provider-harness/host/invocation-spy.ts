/**
 * Invocation recorder for authorization-before-provider verification.
 * @module
 */
type Invocation = { name: string; args: unknown[] };
/**
 * Records provider method calls and arguments.
 */
class InvocationSpy {
  private calls: Invocation[] = [];
  /**
   * Captures a provider method call.
   * @param name - Logical method.
   * @param args - Call arguments.
   * @returns Nothing.
   */
  record(name: string, ...args: unknown[]): void { this.calls.push({name,args}); }
  /**
   * Counts calls by optional method name.
   * @param name - Optional filter.
   * @returns Call count.
   */
  count(name?: string): number { return name ? this.calls.filter((c)=>c.name===name).length : this.calls.length; }
  /**
   * Reads defensive copies of captured invocations.
   * @returns Read-only records.
   */
  all(): readonly Invocation[] { return this.calls.map((c)=>({name:c.name,args:[...c.args]})); }
  /**
   * Asserts a method was never invoked.
   * @param name - Optional method filter.
   * @returns Nothing.
   * @throws Error if matching calls exist.
   */
  assertNotCalled(name?: string): void { const n=this.count(name); if(n!==0) throw new Error(name ? `Expected ${name} not to be invoked; observed ${n} call(s)` : `Expected no invocations; observed ${n}`); }
}
module.exports = { InvocationSpy };
