import { createCodexLeadService } from "../services/codex_lead_service.js";
export async function ccGetUpdates(input) {
    return createCodexLeadService().getUpdates(input);
}
//# sourceMappingURL=cc_get_updates.js.map