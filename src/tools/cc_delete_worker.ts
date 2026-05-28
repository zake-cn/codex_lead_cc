import { createCodexLeadService } from "../services/codex_lead_service.js";
import type { DeleteWorkerInput } from "../types.js";

export async function ccDeleteWorker(input: DeleteWorkerInput) {
  return createCodexLeadService().deleteWorker(input);
}
