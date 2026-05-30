import { createCodexLeadService } from "../services/codex_lead_service.js";
export async function ccAssignTask(input) {
    return createCodexLeadService().assignTask(input);
}
//# sourceMappingURL=cc_assign_task.js.map