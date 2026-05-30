import { createCodexLeadService } from "../services/codex_lead_service.js";
export async function ccWait(input) {
    return createCodexLeadService().wait(input);
}
//# sourceMappingURL=cc_wait.js.map