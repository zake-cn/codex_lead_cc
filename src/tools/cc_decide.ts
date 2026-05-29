import { createCodexLeadService } from "../services/codex_lead_service.js";

export async function ccDecide(input: Record<string, unknown>) {
  return createCodexLeadService().decide(input);
}
