import { createCodexLeadService } from "../services/codex_lead_service.js";
export async function ccGetDiffSummary(input) {
    return createCodexLeadService().getDiffSummary(input);
}
//# sourceMappingURL=cc_get_diff_summary.js.map