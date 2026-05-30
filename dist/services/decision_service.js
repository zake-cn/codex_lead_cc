import { gatewayCall } from "./gateway_result.js";
export class DecisionService {
    service;
    constructor(service) {
        this.service = service;
    }
    async decide(input) {
        const action = requireAction(input);
        return gatewayCall(action, async () => {
            if (action === "approve_permission") {
                return this.service.approvePermission(input);
            }
            if (action === "reject_permission") {
                return this.service.rejectPermission(input);
            }
            if (action === "stop_task") {
                return this.service.stopTask(input);
            }
            if (action === "stop_worker") {
                return this.service.stopWorker(input);
            }
            if (action === "delete_worker") {
                return this.service.deleteWorker(input);
            }
            if (action === "restart_worker") {
                return this.service.restartWorker(input);
            }
            if (action === "mark_notifications_read") {
                return this.service.markNotificationsRead(input);
            }
            if (action === "set_supervisor_state") {
                return this.service.setSupervisorState(input);
            }
            if (action === "cleanup_worktree") {
                return this.service.cleanupWorktree(input);
            }
            if (action === "accept_patch" || action === "reject_patch" || action === "request_changes") {
                return {
                    decision: action,
                    message: "Patch merge is not automated in this local runtime; decision recorded for supervisor flow.",
                };
            }
            if (action === "skip_task" || action === "override_task_status") {
                throw new Error(`${action} is not implemented in compact gateway mode.`);
            }
            throw new Error(`Unknown cc_decide action: ${action}`);
        });
    }
}
function requireAction(input) {
    const action = typeof input.action === "string" ? input.action.trim() : "";
    if (!action) {
        throw new Error("action is required.");
    }
    return action;
}
//# sourceMappingURL=decision_service.js.map