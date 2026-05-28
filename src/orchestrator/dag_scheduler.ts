import type { AgentForemanState, TaskRecord, TaskStatus } from "../types.js";
import { appendEvent } from "./state_store.js";
import { syncLinkedPlanTask } from "./plan_state.js";

const SUCCESS_STATUSES = new Set<TaskStatus>(["completed"]);
const FAILED_DEPENDENCY_STATUSES = new Set<TaskStatus>([
  "failed",
  "timeout",
  "stopped",
  "skipped",
]);

export class DagScheduler {
  updateReadiness(state: AgentForemanState): void {
    for (const task of Object.values(state.tasks).sort((a, b) => a.created_at.localeCompare(b.created_at))) {
      if (!canTransitionTask(task.status)) {
        continue;
      }

      const dependsOn = task.depends_on ?? [];
      const blockers = dependsOn.filter((dependencyId) => {
        const dependency = state.tasks[dependencyId];
        return !dependency || !SUCCESS_STATUSES.has(dependency.status);
      });
      const failedDependency = dependsOn.find((dependencyId) => {
        const dependency = state.tasks[dependencyId];
        return dependency && FAILED_DEPENDENCY_STATUSES.has(dependency.status);
      });

      if (failedDependency) {
        transitionTask(state, task, "skipped", [failedDependency], `Task ${task.id} skipped because dependency ${failedDependency} did not complete.`);
        continue;
      }

      if (blockers.length > 0) {
        transitionTask(state, task, "blocked", blockers, `Task ${task.id} blocked by ${blockers.join(", ")}.`);
        continue;
      }

      transitionTask(state, task, "ready", [], `Task ${task.id} is ready to run.`);
    }
  }
}

function canTransitionTask(status: TaskStatus): boolean {
  return status === "pending" || status === "blocked" || status === "ready";
}

function transitionTask(
  state: AgentForemanState,
  task: TaskRecord,
  nextStatus: "blocked" | "ready" | "skipped",
  blockedBy: string[],
  summary: string,
): void {
  const previousStatus = task.status;
  const previousBlockers = JSON.stringify(task.blocked_by ?? []);
  const nextBlockers = JSON.stringify(blockedBy);
  if (previousStatus === nextStatus && previousBlockers === nextBlockers) {
    return;
  }

  task.status = nextStatus;
  task.blocked_by = blockedBy;
  task.updated_at = new Date().toISOString();
  syncLinkedPlanTask(state, task);

  if (nextStatus === "blocked") {
    appendEvent(state, {
      type: "task_blocked",
      project_id: task.project_id,
      task_id: task.id,
      worker_id: task.worker_id,
      summary,
      payload: { blocked_by: blockedBy },
    });
    return;
  }

  if (nextStatus === "skipped") {
    task.finished_at = task.updated_at;
    task.summary = summary;
    const worker = state.workers[task.worker_id];
    if (worker && worker.current_task_id === task.id) {
      worker.status = "idle";
      delete worker.current_task_id;
      worker.updated_at = task.updated_at;
      worker.last_active_at = task.updated_at;
    }
    appendEvent(state, {
      type: "task_skipped",
      project_id: task.project_id,
      task_id: task.id,
      worker_id: task.worker_id,
      summary,
      payload: { blocked_by: blockedBy },
    });
    return;
  }

  appendEvent(state, {
    type: "task_ready",
    project_id: task.project_id,
    task_id: task.id,
    worker_id: task.worker_id,
    summary,
    payload: {},
  });
}
