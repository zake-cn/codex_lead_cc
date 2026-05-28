import { createCodexLeadService } from "../services/codex_lead_service.js";
import type { GetInboxInput } from "../types.js";

export async function ccGetInbox(input: GetInboxInput) {
  return createCodexLeadService().getInbox(input);
}
