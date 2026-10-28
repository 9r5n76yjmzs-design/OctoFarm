class NoopTelemetry {
  event(_name: string, _attributes: Record<string, unknown> = {}): void {}
  metric(_name: string, _value: number, _attributes: Record<string, unknown> = {}): void {}
}
module.exports = { NoopTelemetry };
