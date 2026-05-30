import { createCodexLeadService } from "../services/codex_lead_service.js";
export async function ccDecide(input) {
    return createCodexLeadService().decide(input);
}
//# sourceMappingURL=cc_decide.js.map