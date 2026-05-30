import { createCodexLeadService } from "../services/codex_lead_service.js";
export async function ccWaitForEvents(input) {
    return createCodexLeadService().waitForEvents(input);
}
//# sourceMappingURL=cc_wait_for_events.js.map