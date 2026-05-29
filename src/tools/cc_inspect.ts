import { createCodexLeadService } from "../services/codex_lead_service.js";

export async function ccInspect(input: Record<string, unknown>) {
  return createCodexLeadService().inspect(input);
}
