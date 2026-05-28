import { createCodexLeadService } from "../services/codex_lead_service.js";
import type { GetWorkerHealthInput } from "../types.js";

export async function ccGetWorkerHealth(input: GetWorkerHealthInput) {
  return createCodexLeadService().getWorkerHealth(input);
}
