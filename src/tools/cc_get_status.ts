import { createCodexLeadService } from "../services/codex_lead_service.js";
import type { GetStatusInput } from "../types.js";

export async function ccGetStatus(input: GetStatusInput) {
  return createCodexLeadService().getStatus(input);
}
