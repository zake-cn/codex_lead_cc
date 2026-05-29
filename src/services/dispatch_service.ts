import path from "node:path";

import type {
  AssignTaskInput,
  CleanupIdleWorkersInput,
  CreatePlanInput,
  CreateWorkerInput,
  RestartWorkerInput,
  UpdatePlanInput,
  WorkerRole,
} from "../types.js";
import { WORKER_ROLES } from "../types.js";
import { CodexLeadService } from "./codex_lead_service.js";
import { gatewayCall, type GatewayResult } from "./gateway_result.js";

const ROLE_ACTIONS: Record<string, WorkerRole> = {
  create_scout_task: "scout",
  create_implementer_task: "implementer",
  create_tester_task: "tester",
  create_reviewer_task: "reviewer",
};

export class DispatchService {
  constructor(private readonly service: CodexLeadService) {}

  async dispatch(input: Record<string, unknown>): Promise<GatewayResult> {
    const action = requireAction(input);
    return gatewayCall(action, async () => {
      if (action === "create_plan") {
        return this.service.createPlan(input as unknown as CreatePlanInput);
      }
      if (action === "update_plan") {
        return this.service.updatePlan(input as unknown as UpdatePlanInput);
      }
      if (action === "create_worker") {
        return this.service.createWorker(input as unknown as CreateWorkerInput);
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
        return this.service.restartWorker(input as unknown as RestartWorkerInput);
      }
      if (action === "cleanup_idle_workers") {
        return this.service.cleanupIdleWorkers(input as unknown as CleanupIdleWorkersInput);
      }
      throw new Error(`Unknown cc_dispatch action: ${action}`);
    });
  }

  private async assignTask(input: Record<string, unknown>) {
    const explicitWorkerId = stringValue(input.worker_id);
    if (explicitWorkerId) {
      return this.service.assignTask(toAssignTaskInput(input, explicitWorkerId));
    }

    const role = normalizeRole(stringValue(input.worker_role) ?? stringValue(input.role));
    const worker = await this.findOrCreateWorker(input, role);
    return this.service.assignTask(toAssignTaskInput(input, worker.id));
  }

  private async assignRoleTask(input: Record<string, unknown>, role: WorkerRole) {
    const worker = await this.findOrCreateWorker(input, role);
    return this.service.assignTask(toAssignTaskInput(input, worker.id));
  }

  private async findOrCreateWorker(input: Record<string, unknown>, role: WorkerRole) {
    const projectId = stringValue(input.project_id);
    const state = await this.service.runtime.store.readState();
    const existing = Object.values(state.workers)
      .filter((worker) => worker.role === role)
      .filter((worker) => worker.status === "idle")
      .filter((worker) => !projectId || worker.project_id === projectId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
    if (existing) {
      return existing;
    }

    const projectPath = stringValue(input.project_path);
    if (!projectPath) {
      throw new Error("project_path is required when assigning by worker role and no idle worker exists.");
    }
    return this.service.createWorker({
      project_path: path.resolve(projectPath),
      project_id: projectId,
      role,
      runtime: stringValue(input.runtime) as CreateWorkerInput["runtime"],
      worktree_mode: stringValue(input.worktree_mode) as CreateWorkerInput["worktree_mode"],
    });
  }
}

function requireAction(input: Record<string, unknown>): string {
  const action = stringValue(input.action);
  if (!action) {
    throw new Error("action is required.");
  }
  return action;
}

function toAssignTaskInput(input: Record<string, unknown>, workerId: string): AssignTaskInput {
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

function taskText(input: Record<string, unknown>): string {
  const direct = stringValue(input.task);
  if (direct) {
    return direct;
  }
  const task = input.task;
  if (task && typeof task === "object" && !Array.isArray(task)) {
    const goal = stringValue((task as Record<string, unknown>).goal);
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

function normalizeRole(role: string | undefined): WorkerRole {
  if (!role || !WORKER_ROLES.includes(role as WorkerRole)) {
    throw new Error(`worker_role must be one of: ${WORKER_ROLES.join(", ")}.`);
  }
  return role as WorkerRole;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function arrayValue(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined;
}
