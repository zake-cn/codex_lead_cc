import { createCodexLeadService } from "../services/codex_lead_service.js";
import type { MetricsInput } from "../types.js";

export async function ccGetMetrics(input: MetricsInput) {
  return createCodexLeadService().getMetrics(input);
}
