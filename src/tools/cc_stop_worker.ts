import { createCodexLeadService } from "../services/codex_lead_service.js";
import type { StopWorkerInput } from "../types.js";

export async function ccStopWorker(input: StopWorkerInput) {
  return createCodexLeadService().stopWorker(input);
}
