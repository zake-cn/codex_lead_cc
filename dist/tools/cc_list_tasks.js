import { createCodexLeadService } from "../services/codex_lead_service.js";
export async function ccListTasks(input) {
    return createCodexLeadService().listTasks(input);
}
//# sourceMappingURL=cc_list_tasks.js.map