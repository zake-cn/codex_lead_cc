import { createCodexLeadService } from "../services/codex_lead_service.js";
import type { GetUpdatesInput } from "../types.js";

export async function ccGetUpdates(input: GetUpdatesInput) {
  return createCodexLeadService().getUpdates(input);
}
