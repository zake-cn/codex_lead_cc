import { createCodexLeadService } from "../services/codex_lead_service.js";
export async function ccStopWorker(input) {
    return createCodexLeadService().stopWorker(input);
}
//# sourceMappingURL=cc_stop_worker.js.map