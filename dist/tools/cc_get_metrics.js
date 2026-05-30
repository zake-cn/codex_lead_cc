import { createCodexLeadService } from "../services/codex_lead_service.js";
export async function ccGetMetrics(input) {
    return createCodexLeadService().getMetrics(input);
}
//# sourceMappingURL=cc_get_metrics.js.map