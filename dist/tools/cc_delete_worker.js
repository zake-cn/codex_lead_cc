import { createCodexLeadService } from "../services/codex_lead_service.js";
export async function ccDeleteWorker(input) {
    return createCodexLeadService().deleteWorker(input);
}
//# sourceMappingURL=cc_delete_worker.js.map