import { createCodexLeadService } from "../services/codex_lead_service.js";
export async function ccStopTask(input) {
    return createCodexLeadService().stopTask(input);
}
//# sourceMappingURL=cc_stop_task.js.map