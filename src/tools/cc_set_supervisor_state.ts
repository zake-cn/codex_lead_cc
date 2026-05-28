import { createCodexLeadService } from "../services/codex_lead_service.js";
import type { SetSupervisorStateInput } from "../types.js";

export async function ccSetSupervisorState(input: SetSupervisorStateInput) {
  return createCodexLeadService().setSupervisorState(input);
}
