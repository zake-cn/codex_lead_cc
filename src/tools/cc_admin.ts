import { createCodexLeadService } from "../services/codex_lead_service.js";

export async function ccAdmin(input: Record<string, unknown>) {
  return createCodexLeadService().admin(input);
}
