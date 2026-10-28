type TelemetryRecord = { kind: 'event' | 'metric'; name: string; attributes: Record<string, unknown>; value?: number };
class RecordingTelemetry {
  private records: TelemetryRecord[] = [];
  event(name: string, attributes: Record<string, unknown> = {}): void { this.records.push({ kind:'event', name, attributes:{...attributes} }); }
  metric(name: string, value: number, attributes: Record<string, unknown> = {}): void { this.records.push({ kind:'metric', name, value, attributes:{...attributes} }); }
  all(): readonly TelemetryRecord[] { return this.records.map((r)=>({...r,attributes:{...r.attributes}})); }
  clear(): void { this.records=[]; }
}
module.exports = { RecordingTelemetry };
