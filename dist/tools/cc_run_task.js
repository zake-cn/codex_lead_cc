import { createCodexLeadService } from "../services/codex_lead_service.js";
export async function ccRunTask(input) {
    return createCodexLeadService().runTask(input);
}
//# sourceMappingURL=cc_run_task.js.map