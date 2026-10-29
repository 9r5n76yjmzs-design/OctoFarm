/**
 * In-memory structured event/metric sink for deterministic assertions.
 * @module
 */
type TelemetryRecord = { kind: 'event' | 'metric'; name: string; attributes: Record<string, unknown>; value?: number };
/**
 * Records structured observability events and metrics.
 */
class RecordingTelemetry {
  private records: TelemetryRecord[] = [];
  /**
   * Records one structured event.
   * @param name - Event name.
   * @param attributes - Structured dimensions.
   * @returns Nothing.
   */
  event(name: string, attributes: Record<string, unknown> = {}): void { this.records.push({ kind:'event', name, attributes:{...attributes} }); }
  /**
   * Records one numeric metric.
   * @param name - Metric name.
   * @param value - Numeric value.
   * @param attributes - Dimensions.
   * @returns Nothing.
   */
  metric(name: string, value: number, attributes: Record<string, unknown> = {}): void { this.records.push({ kind:'metric', name, value, attributes:{...attributes} }); }
  /**
   * Returns copies of recorded telemetry.
   * @returns Read-only records.
   */
  all(): readonly TelemetryRecord[] { return this.records.map((r)=>({...r,attributes:{...r.attributes}})); }
  /**
   * Clears all captured telemetry.
   * @returns Nothing.
   */
  clear(): void { this.records=[]; }
}
module.exports = { RecordingTelemetry };
