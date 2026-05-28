import { createCodexLeadService } from "../services/codex_lead_service.js";
import type { ListWorkersInput } from "../types.js";

export async function ccListWorkers(input: ListWorkersInput) {
  return createCodexLeadService().listWorkers(input);
}
