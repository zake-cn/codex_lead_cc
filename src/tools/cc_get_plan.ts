import { createCodexLeadService } from "../services/codex_lead_service.js";
import type { GetPlanInput } from "../types.js";

export async function ccGetPlan(input: GetPlanInput) {
  return createCodexLeadService().getPlan(input);
}
