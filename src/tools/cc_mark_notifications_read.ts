import { createCodexLeadService } from "../services/codex_lead_service.js";
import type { MarkNotificationsReadInput } from "../types.js";

export async function ccMarkNotificationsRead(input: MarkNotificationsReadInput) {
  return createCodexLeadService().markNotificationsRead(input);
}
