import { createCodexLeadService } from "../services/codex_lead_service.js";
export async function ccApprovePermission(input) {
    return createCodexLeadService().approvePermission(input);
}
//# sourceMappingURL=cc_approve_permission.js.map