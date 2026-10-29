/**
 * No-op telemetry double used to establish that observability is optional.
 * @module
 */
/**
 * Receives events and metrics without recording side effects.
 */
class NoopTelemetry {
  /**
   * Discards a structured event.
   * @param _name - Event name.
   * @param _attributes - Optional dimensions.
   * @returns Nothing.
   */
  event(_name: string, _attributes: Record<string, unknown> = {}): void {}
  /**
   * Discards a metric.
   * @param _name - Metric name.
   * @param _value - Metric value.
   * @param _attributes - Optional dimensions.
   * @returns Nothing.
   */
  metric(_name: string, _value: number, _attributes: Record<string, unknown> = {}): void {}
}
module.exports = { NoopTelemetry };
