import { createCodexLeadService } from "../services/codex_lead_service.js";
import type { GetPendingPermissionsInput } from "../types.js";

export async function ccGetPendingPermissions(input: GetPendingPermissionsInput) {
  return createCodexLeadService().getPendingPermissions(input);
}
