import { createCodexLeadService } from "../services/codex_lead_service.js";
import type { UpdatePlanInput } from "../types.js";

export async function ccUpdatePlan(input: UpdatePlanInput) {
  return createCodexLeadService().updatePlan(input);
}
