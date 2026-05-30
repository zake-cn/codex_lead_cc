import { createCodexLeadService } from "../services/codex_lead_service.js";
export async function ccCleanupIdleWorkers(input) {
    return createCodexLeadService().cleanupIdleWorkers(input);
}
//# sourceMappingURL=cc_cleanup_idle_workers.js.map