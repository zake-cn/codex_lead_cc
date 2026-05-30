import { createCodexLeadService } from "../services/codex_lead_service.js";
export async function ccGetPlan(input) {
    return createCodexLeadService().getPlan(input);
}
//# sourceMappingURL=cc_get_plan.js.map