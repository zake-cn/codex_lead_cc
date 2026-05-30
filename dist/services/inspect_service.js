import { gatewayCall } from "./gateway_result.js";
export class InspectService {
    service;
    constructor(service) {
        this.service = service;
    }
    async inspect(input) {
        const action = requireAction(input);
        return gatewayCall(action, async () => {
            if (action === "get_status") {
                return this.getStatus(input);
            }
            if (action === "list_workers") {
                return this.service.listWorkers(input);
            }
            if (action === "list_tasks") {
                return this.service.listTasks(input);
            }
            if (action === "get_plan") {
                return this.service.getPlan(input);
            }
            if (action === "list_plans") {
                return this.service.listPlans(input);
            }
            if (action === "get_updates") {
                return this.service.getUpdates(input);
            }
            if (action === "get_inbox") {
                return this.service.getInbox(input);
            }
            if (action === "get_report") {
                return this.service.getReport({ level: "summary", ...input });
            }
            if (action === "get_diff_summary") {
                return this.service.getDiffSummary(input);
            }
            if (action === "get_diff_detail") {
                return this.service.getDiffDetail(input);
            }
            if (action === "get_metrics") {
                return this.service.getMetrics(input);
            }
            if (action === "get_pending_permissions") {
                return this.service.getPendingPermissions(input);
            }
            if (action === "get_supervisor_state") {
                return this.service.getSupervisorState(input);
            }
            if (action === "get_worker_health") {
                return this.service.getWorkerHealth(input);
            }
            if (action === "get_benchmark_result") {
                return {
                    message: "Benchmark sample results are available through npm run benchmark.",
                };
            }
            throw new Error(`Unknown cc_inspect action: ${action}`);
        });
    }
    async getStatus(input) {
        if (input.task_id || input.worker_id || input.all) {
            return this.service.getStatus(input);
        }
        const [workers, tasks, pending_permissions, inbox] = await Promise.all([
            this.service.listWorkers({ project_id: stringValue(input.project_id) }),
            this.service.listTasks({ project_id: stringValue(input.project_id) }),
            this.service.getPendingPermissions({ project_id: stringValue(input.project_id) }),
            this.service.getInbox({
                project_id: stringValue(input.project_id),
                plan_id: stringValue(input.plan_id),
                only_unread: true,
                max_notifications: 20,
            }),
        ]);
        return {
            workers: workers.workers,
            tasks: tasks.tasks,
            pending_permissions: pending_permissions.pending_permissions,
            unread_notifications: inbox.notifications,
        };
    }
}
function requireAction(input) {
    const action = stringValue(input.action);
    if (!action) {
        throw new Error("action is required.");
    }
    return action;
}
function stringValue(value) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
//# sourceMappingURL=inspect_service.js.map