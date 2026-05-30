import { createCodexLeadService } from "../services/codex_lead_service.js";
export async function ccCreateWorker(input) {
    return createCodexLeadService().createWorker(input);
}
//# sourceMappingURL=cc_create_worker.js.map