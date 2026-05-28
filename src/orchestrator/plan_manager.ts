import type {
  CreatePlanInput,
  GetPlanInput,
  ListPlansInput,
  PlanChangeRecord,
  PlanRecord,
  PlanSnapshot,
  PlanTaskNode,
  PlanTaskSpec,
  UpdatePlanInput,
} from "../types.js";
import { appendEvent, nextId, nowIso, StateStore } from "./state_store.js";
import { normalizeRole } from "./worker_manager.js";

export class PlanManager {
  constructor(private readonly store: StateStore) {}

  async createPlan(input: CreatePlanInput): Promise<{
    plan_id: string;
    version: number;
    status: PlanRecord["status"];
  }> {
    const projectId = normalizeRequired(input.project_id, "project_id");
    const goal = normalizeRequired(input.goal, "goal");
    const timestamp = nowIso();

    return this.store.updateState((state) => {
      state.counters.plan += 1;
      const planId = nextId("plan", state.counters.plan);
      const tasks = normalizePlanTasks(planId, input.tasks ?? [], 0);
      ensureAcyclic(tasks);

      const plan: PlanRecord = {
        plan_id: planId,
        project_id: projectId,
        version: 1,
        goal,
        status: "active",
        tasks,
        history: [
          snapshotPlan({
            plan_id: planId,
            project_id: projectId,
            version: 1,
            goal,
            status: "active",
            tasks,
            history: [],
            created_at: timestamp,
            updated_at: timestamp,
          }),
        ],
        created_at: timestamp,
        updated_at: timestamp,
      };

      state.plans[planId] = plan;
      appendEvent(state, {
        type: "plan_created",
        project_id: projectId,
        summary: `Created plan ${planId} v1.`,
        payload: { plan_id: planId, goal, tasks: tasks.length },
      });
      return {
        plan_id: plan.plan_id,
        version: plan.version,
        status: plan.status,
      };
    });
  }

  async getPlan(input: GetPlanInput): Promise<Record<string, unknown>> {
    const state = await this.store.readState();
    const plan = state.plans[input.plan_id];
    if (!plan) {
      throw new Error(`Plan not found: ${input.plan_id}`);
    }

    if (input.version) {
      const snapshot = plan.history.find((candidate) => candidate.version === input.version);
      if (!snapshot) {
        throw new Error(`Plan ${input.plan_id} has no version ${input.version}.`);
      }
      return {
        plan_id: plan.plan_id,
        project_id: plan.project_id,
        ...snapshot,
      };
    }

    const changes = Object.values(state.plan_changes)
      .filter((change) => change.plan_id === plan.plan_id)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));

    return {
      ...plan,
      changes,
    };
  }

  async updatePlan(input: UpdatePlanInput): Promise<{
    plan_id: string;
    version: number;
    status: PlanRecord["status"];
    change_id: string;
  }> {
    const reason = normalizeRequired(input.reason, "reason");
    const timestamp = nowIso();

    return this.store.updateState((state) => {
      const plan = state.plans[input.plan_id];
      if (!plan) {
        throw new Error(`Plan not found: ${input.plan_id}`);
      }

      const fromVersion = plan.version;
      const removedTasks = new Set(input.remove_tasks ?? []);
      const updatedTasks: string[] = [];
      let tasks = plan.tasks.filter((task) => !removedTasks.has(task.plan_task_id));

      for (const update of input.update_tasks ?? []) {
        const task = tasks.find((candidate) => candidate.plan_task_id === update.plan_task_id);
        if (!task) {
          throw new Error(`Plan task not found: ${update.plan_task_id}`);
        }
        if (update.goal !== undefined) {
          task.goal = normalizeRequired(update.goal, "update_tasks.goal");
        }
        if (update.status !== undefined) {
          task.status = update.status;
        }
        if (update.depends_on !== undefined) {
          task.depends_on = [...update.depends_on];
        }
        if (update.worker_id !== undefined) {
          task.worker_id = update.worker_id;
        }
        if (update.task_id !== undefined) {
          task.task_id = update.task_id;
        }
        updatedTasks.push(task.plan_task_id);
      }

      const startIndex = nextPlanTaskIndex(tasks);
      const added = normalizePlanTasks(plan.plan_id, input.add_tasks ?? [], startIndex);
      tasks = [...tasks, ...added];
      ensureAcyclic(tasks);

      plan.version += 1;
      plan.goal = input.goal ? normalizeRequired(input.goal, "goal") : plan.goal;
      plan.status = input.status ?? plan.status;
      plan.tasks = tasks;
      plan.updated_at = timestamp;
      plan.history.push(snapshotPlan(plan, reason));

      state.counters.plan_change += 1;
      const changeId = nextId("change", state.counters.plan_change);
      const change: PlanChangeRecord = {
        change_id: changeId,
        plan_id: plan.plan_id,
        project_id: plan.project_id,
        from_version: fromVersion,
        to_version: plan.version,
        reason,
        added_tasks: added.map((task) => task.plan_task_id),
        removed_tasks: [...removedTasks],
        updated_tasks: updatedTasks,
        created_at: timestamp,
      };
      state.plan_changes[changeId] = change;

      appendEvent(state, {
        type: "plan_updated",
        project_id: plan.project_id,
        summary: `Updated plan ${plan.plan_id} to v${plan.version}.`,
        payload: {
          plan_id: plan.plan_id,
          from_version: fromVersion,
          to_version: plan.version,
          reason,
          status: plan.status,
          added_tasks: change.added_tasks,
          removed_tasks: change.removed_tasks,
          updated_tasks: change.updated_tasks,
        },
      });

      return {
        plan_id: plan.plan_id,
        version: plan.version,
        status: plan.status,
        change_id: changeId,
      };
    });
  }

  async listPlans(input: ListPlansInput): Promise<{ plans: PlanRecord[] }> {
    const state = await this.store.readState();
    return {
      plans: Object.values(state.plans)
        .filter((plan) => {
          if (input.project_id && plan.project_id !== input.project_id) {
            return false;
          }
          if (input.status && plan.status !== input.status) {
            return false;
          }
          return true;
        })
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    };
  }
}

function normalizePlanTasks(planId: string, specs: PlanTaskSpec[], startIndex: number): PlanTaskNode[] {
  return specs.map((spec, index) => {
    normalizeRole(spec.role);
    return {
      plan_task_id: `${planId}_step_${String(startIndex + index + 1).padStart(3, "0")}`,
      role: spec.role,
      goal: normalizeRequired(spec.goal, "tasks.goal"),
      depends_on: [...(spec.depends_on ?? [])],
      worker_id: spec.worker_id,
      task_id: spec.task_id,
      status: spec.task_id ? "pending" : "planned",
    };
  });
}

function snapshotPlan(plan: PlanRecord, reason?: string): PlanSnapshot {
  return {
    version: plan.version,
    status: plan.status,
    goal: plan.goal,
    tasks: plan.tasks.map((task) => ({
      ...task,
      depends_on: [...(task.depends_on ?? [])],
    })),
    reason,
    created_at: nowIso(),
  };
}

function ensureAcyclic(tasks: PlanTaskNode[]): void {
  const taskIds = new Set(tasks.map((task) => task.plan_task_id));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(tasks.map((task) => [task.plan_task_id, task]));

  const visit = (taskId: string, stack: string[]): void => {
    if (visited.has(taskId)) {
      return;
    }
    if (visiting.has(taskId)) {
      throw new Error(`Plan DAG contains a cycle: ${[...stack, taskId].join(" -> ")}`);
    }
    visiting.add(taskId);
    const task = byId.get(taskId);
    for (const dep of task?.depends_on ?? []) {
      if (!taskIds.has(dep)) {
        throw new Error(`Plan task ${taskId} depends on unknown plan task ${dep}.`);
      }
      visit(dep, [...stack, taskId]);
    }
    visiting.delete(taskId);
    visited.add(taskId);
  };

  for (const task of tasks) {
    visit(task.plan_task_id, []);
  }
}

function nextPlanTaskIndex(tasks: PlanTaskNode[]): number {
  return tasks.reduce((max, task) => {
    const match = /_step_(\d+)$/.exec(task.plan_task_id);
    return Math.max(max, match ? Number(match[1]) : 0);
  }, 0);
}

function normalizeRequired(value: string | undefined, name: string): string {
  if (!value || typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} is required and must be a non-empty string.`);
  }
  return value.trim();
}
