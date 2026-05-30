import { createCodexLeadService } from "../services/codex_lead_service.js";
export async function ccGetInbox(input) {
    return createCodexLeadService().getInbox(input);
}
//# sourceMappingURL=cc_get_inbox.js.map