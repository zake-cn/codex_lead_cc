import { createRuntime } from "../orchestrator/runtime.js";
import type { MetricsInput } from "../types.js";

export async function ccGetMetrics(input: MetricsInput) {
  const runtime = createRuntime();
  return runtime.metrics.getMetrics(input);
}
