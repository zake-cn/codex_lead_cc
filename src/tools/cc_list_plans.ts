import { createCodexLeadService } from "../services/codex_lead_service.js";
import type { ListPlansInput } from "../types.js";

export async function ccListPlans(input: ListPlansInput) {
  return createCodexLeadService().listPlans(input);
}
