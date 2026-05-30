import { createCodexLeadService } from "../services/codex_lead_service.js";
export async function ccGetWorkerHealth(input) {
    return createCodexLeadService().getWorkerHealth(input);
}
//# sourceMappingURL=cc_get_worker_health.js.map