import { createCodexLeadService } from "../services/codex_lead_service.js";
import type { RejectPermissionInput } from "../types.js";

export async function ccRejectPermission(input: RejectPermissionInput) {
  return createCodexLeadService().rejectPermission(input);
}
