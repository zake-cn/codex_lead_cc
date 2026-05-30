import { createCodexLeadService } from "../services/codex_lead_service.js";
export async function ccMarkNotificationsRead(input) {
    return createCodexLeadService().markNotificationsRead(input);
}
//# sourceMappingURL=cc_mark_notifications_read.js.map