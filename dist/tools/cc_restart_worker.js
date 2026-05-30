import { createCodexLeadService } from "../services/codex_lead_service.js";
export async function ccRestartWorker(input) {
    return createCodexLeadService().restartWorker(input);
}
//# sourceMappingURL=cc_restart_worker.js.map