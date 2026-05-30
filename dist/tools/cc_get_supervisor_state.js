import { createCodexLeadService } from "../services/codex_lead_service.js";
export async function ccGetSupervisorState(input) {
    return createCodexLeadService().getSupervisorState(input);
}
//# sourceMappingURL=cc_get_supervisor_state.js.map