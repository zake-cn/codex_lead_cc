import { createCodexLeadService } from "../services/codex_lead_service.js";
import type { ApprovePermissionInput } from "../types.js";

export async function ccApprovePermission(input: ApprovePermissionInput) {
  return createCodexLeadService().approvePermission(input);
}
