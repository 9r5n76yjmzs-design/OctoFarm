const { FakeClock } = require('./fake-clock.ts');

type Task = { id: number; dueAt: number; sequence: number; callback: () => void; cancelled: boolean };

class FakeScheduler {
  private clock: InstanceType<typeof FakeClock>;
  private nextId = 1;
  private nextSequence = 1;
  private tasks: Task[] = [];
  private stopped = false;

  constructor(clock = new FakeClock()) { this.clock = clock; }
  schedule(delayMs: number, callback: () => void): number {
    if (this.stopped) throw new Error('FakeScheduler is stopped');
    if (!Number.isFinite(delayMs) || delayMs < 0) throw new Error('delayMs must be non-negative and finite');
    const task: Task = { id: this.nextId++, dueAt: this.clock.now() + delayMs, sequence: this.nextSequence++, callback, cancelled: false };
    this.tasks.push(task); return task.id;
  }
  cancel(id: number): boolean { const t=this.tasks.find((x)=>x.id===id && !x.cancelled); if(!t) return false; t.cancelled=true; return true; }
  pending(): number { return this.tasks.filter((t)=>!t.cancelled).length; }
  advanceBy(ms: number): void { this.clock.advanceBy(ms); this.runDue(); }
  runNext(): boolean {
    const next=this.nextTask(); if(!next) return false;
    if(next.dueAt>this.clock.now()) this.clock.set(next.dueAt);
    this.execute(next); return true;
  }
  runDue(): void { let next=this.nextTask(); while(next && next.dueAt<=this.clock.now()){ this.execute(next); next=this.nextTask(); } }
  shutdown(): void { this.stopped=true; this.tasks=[]; }
  private nextTask(): Task | undefined { return this.tasks.filter((t)=>!t.cancelled).sort((a,b)=>a.dueAt-b.dueAt || a.sequence-b.sequence)[0]; }
  private execute(task: Task): void { this.tasks=this.tasks.filter((t)=>t.id!==task.id); if(!task.cancelled) task.callback(); }
}
module.exports = { FakeScheduler };
