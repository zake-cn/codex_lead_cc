import { createCodexLeadService } from "../services/codex_lead_service.js";
export async function ccRejectPermission(input) {
    return createCodexLeadService().rejectPermission(input);
}
//# sourceMappingURL=cc_reject_permission.js.map