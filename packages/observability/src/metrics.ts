import { RUNTIME_VERSION } from "../../domain/src/index.js";

export class RuntimeMetrics {
  readonly #counters = new Map<string, number>();

  increment(name: string, labels: Record<string, string> = {}, amount = 1): void {
    const key = metricKey(name, labels);
    this.#counters.set(key, (this.#counters.get(key) ?? 0) + amount);
  }

  render(gauges: Record<string, number> = {}): string {
    const lines = [
      "# HELP sdar_runtime_info Runtime build information.",
      "# TYPE sdar_runtime_info gauge",
      `sdar_runtime_info{version="${RUNTIME_VERSION}"} 1`,
    ];
    for (const [key, value] of [...this.#counters].sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      lines.push(`${key} ${String(value)}`);
    }
    for (const [key, value] of Object.entries(gauges).sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      lines.push(`${key} ${String(value)}`);
    }
    return `${lines.join("\n")}\n`;
  }
}

export type MetricName =
  | "sdar_tool_calls_total"
  | "sdar_tool_call_duration_seconds_count"
  | "sdar_tool_call_duration_seconds_sum"
  | "sdar_cancel_requests_total"
  | "sdar_recovery_total"
  | "sdar_adapter_rpc_total"
  | "sdar_adapter_identity_conflicts_total"
  | "sdar_ttl_cleaner_total"
  | "sdar_outbox_delivery_total"
  | "sdar_idempotency_hits_total"
  | "sdar_rate_limited_total";

function metricKey(name: string, labels: Record<string, string>): string {
  const entries = Object.entries(labels).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) return name;
  return `${name}{${entries
    .map(([key, value]) => `${key}="${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`)
    .join(",")}}`;
}
