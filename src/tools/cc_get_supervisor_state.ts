import { createCodexLeadService } from "../services/codex_lead_service.js";
import type { GetSupervisorStateInput } from "../types.js";

export async function ccGetSupervisorState(input: GetSupervisorStateInput) {
  return createCodexLeadService().getSupervisorState(input);
}
