import { createCodexLeadService } from "../services/codex_lead_service.js";
export async function ccListPlans(input) {
    return createCodexLeadService().listPlans(input);
}
//# sourceMappingURL=cc_list_plans.js.map