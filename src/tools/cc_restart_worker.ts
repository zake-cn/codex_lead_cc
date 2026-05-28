import { createCodexLeadService } from "../services/codex_lead_service.js";
import type { RestartWorkerInput } from "../types.js";

export async function ccRestartWorker(input: RestartWorkerInput) {
  return createCodexLeadService().restartWorker(input);
}
