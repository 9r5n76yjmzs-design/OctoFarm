const assert = require('node:assert/strict');
const { test } = require('node:test');
const { FakeClock } = require('./fake-clock.ts');
const { FakeScheduler } = require('./fake-scheduler.ts');
const { EventCollector } = require('./event-collector.ts');
const { SecretLeakDetector } = require('./secret-leak-detector.ts');
const { RecordingTelemetry } = require('./recording-telemetry.ts');
const { NoopTelemetry } = require('./noop-telemetry.ts');
const { PolicyNetworkClient } = require('./policy-network-client.ts');
const { SafeTestStorage } = require('./safe-test-storage.ts');
const { AuthorizationSpy } = require('./authorization-spy.ts');
const { InvocationSpy } = require('./invocation-spy.ts');

test('FakeClock and FakeScheduler execute deterministically without wall-clock sleeps', () => {
  const clock = new FakeClock('2026-01-01T00:00:00Z'); const scheduler = new FakeScheduler(clock); const seen: string[]=[];
  scheduler.schedule(1000,()=>seen.push('first')); scheduler.schedule(1000,()=>seen.push('second')); scheduler.schedule(2000,()=>seen.push('third'));
  scheduler.advanceBy(999); assert.deepEqual(seen,[]); scheduler.advanceBy(1); assert.deepEqual(seen,['first','second']); scheduler.advanceBy(1000); assert.deepEqual(seen,['first','second','third']);
});

test('scheduler shutdown is terminal for queued work', () => { const clock=new FakeClock(); const scheduler=new FakeScheduler(clock); let calls=0; scheduler.schedule(1,()=>calls++); scheduler.shutdown(); assert.equal(scheduler.pending(),0); assert.throws(()=>scheduler.schedule(1,()=>calls++),/stopped/); clock.advanceBy(10); assert.equal(calls,0); });

test('EventCollector records ordered evidence and rejects post-close emission', () => { const c=new EventCollector<string>(); c.emit('a'); c.emit('b'); assert.deepEqual(c.all(),['a','b']); c.close(); assert.throws(()=>c.emit('c'),/closed/); });

test('SecretLeakDetector finds synthetic secrets in nested evidence', () => { const d=new SecretLeakDetector(); d.seed('SYNTHETIC_TEST_SECRET'); assert.deepEqual(d.scan({error:{detail:'contains SYNTHETIC_TEST_SECRET'}}),['SYNTHETIC_TEST_SECRET']); assert.throws(()=>d.assertClean('SYNTHETIC_TEST_SECRET'),/secret leak/i); d.assertClean({ok:true}); const error=new Error('leaked SYNTHETIC_TEST_SECRET'); assert.deepEqual(d.scan(error),['SYNTHETIC_TEST_SECRET']); const cyclic:any={}; cyclic.self=cyclic; d.assertClean(cyclic); });

test('RecordingTelemetry records structured events and metrics', () => { const t=new RecordingTelemetry(); t.event('connect',{providerId:'sample'}); t.metric('queue.depth',2,{printerId:'p1'}); assert.equal(t.all().length,2); assert.equal(t.all()[1].value,2); });

test('PolicyNetworkClient allows configured origins and blocks others/redirect overflow', () => { const n=new PolicyNetworkClient({allowedOrigins:['http://127.0.0.1:8080'],maxRedirects:1}); n.authorize('http://127.0.0.1:8080/api/version'); assert.throws(()=>n.authorize('https://example.com/x'),/denied destination/); assert.throws(()=>n.authorize('http://127.0.0.1:8080/redirect',2),/redirect limit/); assert.equal(n.history().filter((x:any)=>!x.allowed).length,2); });

test('SafeTestStorage confines logical paths and preserves bytes', () => { const s=new SafeTestStorage(); s.write('jobs/example.gcode','G28'); assert.equal(Buffer.from(s.read('jobs/example.gcode')).toString(),'G28'); assert.deepEqual(s.list(),['jobs/example.gcode']); assert.throws(()=>s.write('../escape','x'),/escapes root/); assert.throws(()=>s.write('..\\escape','x'),/escapes root/); assert.throws(()=>s.write('/absolute','x'),/relative/); });

test('NoopTelemetry accepts calls without retaining evidence', () => { const t=new NoopTelemetry(); assert.doesNotThrow(()=>{ t.event('anything',{secret:'synthetic'}); t.metric('value',1); }); });

test('AuthorizationSpy records explicit allow/deny decisions', () => { const spy=new AuthorizationSpy(); spy.allow('health'); spy.deny('restart','ROLE_REQUIRED'); assert.equal(spy.count(),2); assert.deepEqual(spy.last('restart'),{operation:'restart',allowed:false,reason:'ROLE_REQUIRED'}); });

test('InvocationSpy can prove provider invocation never occurred', () => { const spy=new InvocationSpy(); spy.assertNotCalled('startPrint'); spy.record('health'); assert.equal(spy.count('health'),1); assert.throws(()=>spy.assertNotCalled(),/observed 1/); });
