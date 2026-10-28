type Invocation = { name: string; args: unknown[] };
class InvocationSpy {
  private calls: Invocation[] = [];
  record(name: string, ...args: unknown[]): void { this.calls.push({name,args}); }
  count(name?: string): number { return name ? this.calls.filter((c)=>c.name===name).length : this.calls.length; }
  all(): readonly Invocation[] { return this.calls.map((c)=>({name:c.name,args:[...c.args]})); }
  assertNotCalled(name?: string): void { const n=this.count(name); if(n!==0) throw new Error(name ? `Expected ${name} not to be invoked; observed ${n} call(s)` : `Expected no invocations; observed ${n}`); }
}
module.exports = { InvocationSpy };
