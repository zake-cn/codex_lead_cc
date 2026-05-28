import { createCodexLeadService } from "../services/codex_lead_service.js";
import type { CleanupIdleWorkersInput } from "../types.js";

export async function ccCleanupIdleWorkers(input: CleanupIdleWorkersInput) {
  return createCodexLeadService().cleanupIdleWorkers(input);
}
