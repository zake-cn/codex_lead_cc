import { createCodexLeadService } from "../services/codex_lead_service.js";
import type { CreateWorkerInput } from "../types.js";

export async function ccCreateWorker(input: CreateWorkerInput) {
  return createCodexLeadService().createWorker(input);
}
