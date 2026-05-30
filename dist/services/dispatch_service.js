import path from "node:path";
import { WORKER_ROLES } from "../types.js";
import { gatewayCall } from "./gateway_result.js";
const ROLE_ACTIONS = {
    create_scout_task: "scout",
    create_implementer_task: "implementer",
    create_tester_task: "tester",
    create_reviewer_task: "reviewer",
};
export class DispatchService {
    service;
    constructor(service) {
        this.service = service;
    }
    async dispatch(input) {
        const action = requireAction(input);
        return gatewayCall(action, async () => {
            if (action === "create_plan") {
                return this.service.createPlan(input);
            }
            if (action === "update_plan") {
                return this.service.updatePlan(input);
            }
            if (action === "create_worker") {
                return this.service.createWorker(input);
            }
            if (action === "assign_task") {
                return this.assignTask(input);
            }
            if (action in ROLE_ACTIONS) {
                return this.assignRoleTask(input, ROLE_ACTIONS[action]);
            }
            if (action === "dispatch_ready_tasks") {
                return this.service.runtime.scheduler.schedule();
            }
            if (action === "restart_worker") {
                return this.service.restartWorker(input);
            }
            if (action === "cleanup_idle_workers") {
                return this.service.cleanupIdleWorkers(input);
            }
            throw new Error(`Unknown cc_dispatch action: ${action}`);
        });
    }
    async assignTask(input) {
        const explicitWorkerId = stringValue(input.worker_id);
        if (explicitWorkerId) {
            return this.service.assignTask(toAssignTaskInput(input, explicitWorkerId));
        }
        const role = normalizeRole(stringValue(input.worker_role) ?? stringValue(input.role));
        const worker = await this.findOrCreateWorker(input, role);
        return this.service.assignTask(toAssignTaskInput(input, worker.id));
    }
    async assignRoleTask(input, role) {
        const worker = await this.findOrCreateWorker(input, role);
        return this.service.assignTask(toAssignTaskInput(input, worker.id));
    }
    async findOrCreateWorker(input, role) {
        const defaults = await this.service.projectDefaults(input);
        const projectId = stringValue(input.project_id) ?? defaults.project_id;
        const state = await this.service.runtime.store.readState();
        const existing = Object.values(state.workers)
            .filter((worker) => worker.role === role)
            .filter((worker) => worker.status === "idle")
            .filter((worker) => !projectId || worker.project_id === projectId)
            .sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
        if (existing) {
            return existing;
        }
        const projectPath = stringValue(input.project_path) ?? defaults.project_path;
        if (!projectPath) {
            throw new Error("project_path is required when no codex_lead_cc project session is active.");
        }
        return this.service.createWorker({
            project_path: path.resolve(projectPath),
            project_id: projectId,
            role,
            runtime: stringValue(input.runtime),
            worktree_mode: stringValue(input.worktree_mode),
        });
    }
}
function requireAction(input) {
    const action = stringValue(input.action);
    if (!action) {
        throw new Error("action is required.");
    }
    return action;
}
function toAssignTaskInput(input, workerId) {
    const task = taskText(input);
    return {
        worker_id: workerId,
        task,
        timeout_sec: numberValue(input.timeout_sec),
        target_task_id: stringValue(input.target_task_id),
        depends_on: arrayValue(input.depends_on),
        plan_id: stringValue(input.plan_id),
        plan_task_id: stringValue(input.plan_task_id),
    };
}
function taskText(input) {
    const direct = stringValue(input.task);
    if (direct) {
        return direct;
    }
    const task = input.task;
    if (task && typeof task === "object" && !Array.isArray(task)) {
        const goal = stringValue(task.goal);
        if (goal) {
            return goal;
        }
    }
    const goal = stringValue(input.goal);
    if (goal) {
        return goal;
    }
    throw new Error("task or task.goal is required.");
}
function normalizeRole(role) {
    if (!role || !WORKER_ROLES.includes(role)) {
        throw new Error(`worker_role must be one of: ${WORKER_ROLES.join(", ")}.`);
    }
    return role;
}
function stringValue(value) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function numberValue(value) {
    return typeof value === "number" ? value : undefined;
}
function arrayValue(value) {
    return Array.isArray(value) ? value.filter((item) => typeof item === "string") : undefined;
}
//# sourceMappingURL=dispatch_service.js.map