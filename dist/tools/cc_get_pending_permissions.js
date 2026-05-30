import { createCodexLeadService } from "../services/codex_lead_service.js";
export async function ccGetPendingPermissions(input) {
    return createCodexLeadService().getPendingPermissions(input);
}
//# sourceMappingURL=cc_get_pending_permissions.js.map