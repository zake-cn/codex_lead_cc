import { createCodexLeadService } from "../services/codex_lead_service.js";
import type { CreatePlanInput } from "../types.js";

export async function ccCreatePlan(input: CreatePlanInput) {
  return createCodexLeadService().createPlan(input);
}
