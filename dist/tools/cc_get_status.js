import { createCodexLeadService } from "../services/codex_lead_service.js";
export async function ccGetStatus(input) {
    return createCodexLeadService().getStatus(input);
}
//# sourceMappingURL=cc_get_status.js.map