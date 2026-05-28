import { createCodexLeadService } from "../services/codex_lead_service.js";
import type { AssignTaskInput } from "../types.js";

export async function ccAssignTask(input: AssignTaskInput) {
  return createCodexLeadService().assignTask(input);
}
