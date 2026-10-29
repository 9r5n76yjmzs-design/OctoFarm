/**
 * Manually driven scheduler for deterministic retry and shutdown testing.
 * @module
 */
const { FakeClock } = require('./fake-clock.ts');

type Task = { id: number; dueAt: number; sequence: number; callback: () => void; cancelled: boolean };

/**
 * Schedules callbacks in due-time and stable insertion order.
 */
class FakeScheduler {
  private clock: InstanceType<typeof FakeClock>;
  private nextId = 1;
  private nextSequence = 1;
  private tasks: Task[] = [];
  private stopped = false;

  /**
   * Binds the fake clock.
   * @param clock - Controllable clock.
   */
  constructor(clock = new FakeClock()) { this.clock = clock; }
  /**
   * Queues a callback.
   * @param delayMs - Delay in fake milliseconds.
   * @param callback - Task body.
   * @returns Task identifier.
   */
  schedule(delayMs: number, callback: () => void): number {
    if (this.stopped) throw new Error('FakeScheduler is stopped');
    if (!Number.isFinite(delayMs) || delayMs < 0) throw new Error('delayMs must be non-negative and finite');
    const task: Task = { id: this.nextId++, dueAt: this.clock.now() + delayMs, sequence: this.nextSequence++, callback, cancelled: false };
    this.tasks.push(task); return task.id;
  }
  /**
   * Cancels a pending callback.
   * @param id - Task identifier.
   * @returns True when cancelled.
   */
  cancel(id: number): boolean { const t=this.tasks.find((x)=>x.id===id && !x.cancelled); if(!t) return false; t.cancelled=true; return true; }
  /**
   * Counts uncancelled callbacks.
   * @returns Pending task count.
   */
  pending(): number { return this.tasks.filter((t)=>!t.cancelled).length; }
  /**
   * Advances fake time and invokes due work.
   * @param ms - Fake milliseconds.
   * @returns Nothing.
   */
  advanceBy(ms: number): void { this.clock.advanceBy(ms); this.runDue(); }
  /**
   * Runs the earliest task, advancing fake time if necessary.
   * @returns True if a task ran.
   */
  runNext(): boolean {
    const next=this.nextTask(); if(!next) return false;
    if(next.dueAt>this.clock.now()) this.clock.set(next.dueAt);
    this.execute(next); return true;
  }
  /**
   * Drains due work.
   * @returns Nothing.
   */
  runDue(): void { let next=this.nextTask(); while(next && next.dueAt<=this.clock.now()){ this.execute(next); next=this.nextTask(); } }
  /**
   * Discards queued work and stops scheduling.
   * @returns Nothing.
   */
  shutdown(): void { this.stopped=true; this.tasks=[]; }
  /**
   * Finds the next scheduled task.
   * @returns Task or undefined.
   */
  private nextTask(): Task | undefined { return this.tasks.filter((t)=>!t.cancelled).sort((a,b)=>a.dueAt-b.dueAt || a.sequence-b.sequence)[0]; }
  /**
   * Removes and invokes one scheduled callback.
   * @param task - Task to execute.
   * @returns Nothing.
   */
  private execute(task: Task): void { this.tasks=this.tasks.filter((t)=>t.id!==task.id); if(!task.cancelled) task.callback(); }
}
module.exports = { FakeScheduler };
