import { createCodexLeadService } from "../services/codex_lead_service.js";
export async function ccListWorkers(input) {
    return createCodexLeadService().listWorkers(input);
}
//# sourceMappingURL=cc_list_workers.js.map