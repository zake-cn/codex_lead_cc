import { createCodexLeadService } from "../services/codex_lead_service.js";

export async function ccWait(input: Record<string, unknown>) {
  return createCodexLeadService().wait(input);
}
