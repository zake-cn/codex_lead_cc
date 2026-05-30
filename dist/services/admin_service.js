import { TOOL_CATALOG } from "../tools/tool_catalog.js";
import { gatewayCall } from "./gateway_result.js";
export class AdminService {
    service;
    constructor(service) {
        this.service = service;
    }
    async admin(input) {
        const action = typeof input.action === "string" && input.action.trim() ? input.action.trim() : "list_tools";
        return gatewayCall(action, async () => {
            if (action === "list_tools") {
                return {
                    compact_tools: ["cc_dispatch", "cc_wait", "cc_inspect", "cc_decide"],
                    full_tools: Object.keys(TOOL_CATALOG).sort(),
                };
            }
            if (action === "dump_state_summary") {
                const state = await this.service.runtime.store.readState();
                return {
                    workers: Object.keys(state.workers).length,
                    tasks: Object.keys(state.tasks).length,
                    plans: Object.keys(state.plans).length,
                    events: state.events.length,
                    notifications: Object.keys(state.notifications).length,
                    permission_requests: Object.keys(state.permission_requests).length,
                };
            }
            throw new Error(`Unknown cc_admin action: ${action}`);
        });
    }
}
//# sourceMappingURL=admin_service.js.map