import { Registry } from "prom-client";

export const metricsRegistry = new Registry();

export function resetMetricsRegistry(): void {
  metricsRegistry.resetMetrics();
}

export const metricsContentType = metricsRegistry.contentType;

export async function renderMetrics(): Promise<string> {
  return metricsRegistry.metrics();
}
