import { createCodexLeadService } from "../services/codex_lead_service.js";
export async function ccSetSupervisorState(input) {
    return createCodexLeadService().setSupervisorState(input);
}
//# sourceMappingURL=cc_set_supervisor_state.js.map