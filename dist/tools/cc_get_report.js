import { createCodexLeadService } from "../services/codex_lead_service.js";
export async function ccGetReport(input) {
    return createCodexLeadService().getReport(input);
}
//# sourceMappingURL=cc_get_report.js.map