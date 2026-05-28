import { loadConfig } from "../config/load_config.js";
import type {
  AgentForemanState,
  ApprovePermissionInput,
  PermissionDecision,
  PermissionEffect,
  PermissionRequestRecord,
  PermissionRuleRecord,
  RejectPermissionInput,
  RiskLevel,
  TaskRecord,
  WorkerRole,
} from "../types.js";
import { appendEvent, nextId, nowIso, StateStore } from "./state_store.js";
import { syncLinkedPlanTask } from "./plan_state.js";

export class PermissionEngine {
  constructor(private readonly store: StateStore) {}

  async getPendingPermissions(input: { project_id?: string }): Promise<{
    pending_permissions: PermissionRequestRecord[];
  }> {
    const state = await this.store.readState();
    return {
      pending_permissions: Object.values(state.permission_requests).filter((request) => {
        if (request.status !== "pending") {
          return false;
        }
        return input.project_id ? request.project_id === input.project_id : true;
      }),
    };
  }

  async approve(input: ApprovePermissionInput): Promise<{
    request_id: string;
    status: "approved";
    decision: PermissionDecision;
    task_id: string;
  }> {
    const timestamp = nowIso();
    return this.store.updateState((state) => {
      const request = state.permission_requests[input.request_id];
      if (!request) {
        throw new Error(`Permission request not found: ${input.request_id}`);
      }
      if (request.status !== "pending") {
        throw new Error(`Permission request ${input.request_id} is already ${request.status}.`);
      }

      request.status = "approved";
      request.decision = input.decision;
      request.resolved_at = timestamp;

      if (input.decision === "allow_for_task" || input.decision === "allow_for_project") {
        state.counters.rule += 1;
        const rule: PermissionRuleRecord = {
          id: nextId("rule", state.counters.rule),
          project_id: request.project_id,
          effect: "allow",
          tool: request.tool,
          pattern: request.action,
          scope: input.decision === "allow_for_task" ? "task" : "project",
          task_id: input.decision === "allow_for_task" ? request.task_id : undefined,
          expires_at: null,
          created_by: "codex_supervisor",
          created_at: timestamp,
        };
        state.permission_rules[rule.id] = rule;
      }

      const task = state.tasks[request.task_id];
      if (task && task.status === "waiting_permission") {
        task.status = "pending";
        task.permission_request_id = undefined;
        task.updated_at = timestamp;
        syncLinkedPlanTask(state, task);
      }

      appendEvent(state, {
        type: "permission_approved",
        project_id: request.project_id,
        task_id: request.task_id,
        worker_id: request.worker_id,
        summary: `Permission ${request.id} approved with ${input.decision}.`,
        payload: { request_id: request.id, decision: input.decision },
      });

      return {
        request_id: request.id,
        status: "approved",
        decision: input.decision,
        task_id: request.task_id,
      };
    });
  }

  async reject(input: RejectPermissionInput): Promise<{
    request_id: string;
    status: "rejected";
    reason: string;
    task_id: string;
  }> {
    const timestamp = nowIso();
    return this.store.updateState((state) => {
      const request = state.permission_requests[input.request_id];
      if (!request) {
        throw new Error(`Permission request not found: ${input.request_id}`);
      }
      if (request.status !== "pending") {
        throw new Error(`Permission request ${input.request_id} is already ${request.status}.`);
      }

      const reason = input.reason ?? "Permission rejected by supervisor.";
      request.status = "rejected";
      request.decision = "deny";
      request.resolution_reason = reason;
      request.resolved_at = timestamp;

      const task = state.tasks[request.task_id];
      if (task) {
        task.status = "failed";
        task.error = reason;
        task.summary = `Task blocked by rejected permission: ${reason}`;
        task.finished_at = timestamp;
        task.updated_at = timestamp;
        syncLinkedPlanTask(state, task);
        const worker = state.workers[task.worker_id];
        if (worker && worker.current_task_id === task.id) {
          worker.status = "idle";
          delete worker.current_task_id;
          worker.updated_at = timestamp;
          worker.last_active_at = timestamp;
          const session = worker.session_id ? state.sessions[worker.session_id] : undefined;
          if (session) {
            session.status = "idle";
            session.last_active_at = timestamp;
          }
        }
      }

      appendEvent(state, {
        type: "permission_rejected",
        project_id: request.project_id,
        task_id: request.task_id,
        worker_id: request.worker_id,
        summary: `Permission ${request.id} rejected: ${reason}`,
        payload: { request_id: request.id, reason },
      });

      if (task) {
        appendEvent(state, {
          type: "task_failed",
          project_id: task.project_id,
          task_id: task.id,
          worker_id: task.worker_id,
          summary: `Task ${task.id} failed because permission was rejected.`,
          payload: { permission_request_id: request.id },
        });
      }

      return {
        request_id: request.id,
        status: "rejected",
        reason,
        task_id: request.task_id,
      };
    });
  }

  async applyPermissionGate(task: TaskRecord): Promise<"allow" | "waiting_permission" | "denied"> {
    const config = await loadConfig(task.project_path);
    return this.store.updateState((state) => {
      const latestTask = state.tasks[task.id];
      if (!latestTask) {
        throw new Error(`Task not found while applying permission gate: ${task.id}`);
      }
      const evaluation = evaluateTaskPermission(latestTask, [
        ...Object.values(state.permission_rules),
        ...config.permission_rules.map((rule, index) => ({
          id: `config_${index}`,
          created_at: nowIso(),
          ...rule,
        })),
      ]);

      if (evaluation.effect === "allow") {
        return "allow";
      }

      if (evaluation.effect === "deny") {
        const timestamp = nowIso();
        latestTask.status = "failed";
        latestTask.error = `Permission denied by policy: ${evaluation.action}`;
        latestTask.summary = latestTask.error;
        latestTask.finished_at = timestamp;
        latestTask.updated_at = timestamp;
        syncLinkedPlanTask(state, latestTask);
        const worker = state.workers[latestTask.worker_id];
        if (worker && worker.current_task_id === latestTask.id) {
          worker.status = "idle";
          delete worker.current_task_id;
          worker.updated_at = timestamp;
          worker.last_active_at = timestamp;
          const session = worker.session_id ? state.sessions[worker.session_id] : undefined;
          if (session) {
            session.status = "idle";
            session.last_active_at = timestamp;
          }
        }
        appendEvent(state, {
          type: "task_failed",
          project_id: latestTask.project_id,
          task_id: latestTask.id,
          worker_id: latestTask.worker_id,
          summary: `Task ${latestTask.id} denied by permission policy.`,
          payload: { action: evaluation.action, risk_level: evaluation.risk_level },
        });
        return "denied";
      }

      state.counters.permission += 1;
      const requestId = nextId("perm", state.counters.permission);
      const timestamp = nowIso();
      const request: PermissionRequestRecord = {
        id: requestId,
        project_id: latestTask.project_id,
        task_id: latestTask.id,
        worker_id: latestTask.worker_id,
        tool: evaluation.tool,
        action: evaluation.action,
        risk_level: evaluation.risk_level,
        reason: evaluation.reason,
        affected_paths: evaluation.affected_paths,
        status: "pending",
        suggested_decision: evaluation.risk_level === "danger" ? "deny" : "allow_for_task",
        choices: ["allow_once", "allow_for_task", "allow_for_project", "deny"],
        created_at: timestamp,
      };
      state.permission_requests[request.id] = request;
      latestTask.status = "waiting_permission";
      latestTask.permission_request_id = request.id;
      latestTask.updated_at = timestamp;
      syncLinkedPlanTask(state, latestTask);

      appendEvent(state, {
        type: "permission_requested",
        project_id: latestTask.project_id,
        task_id: latestTask.id,
        worker_id: latestTask.worker_id,
        summary: `Worker ${latestTask.worker_id} requested permission for ${evaluation.action}.`,
        payload: request as unknown as Record<string, unknown>,
      });
      return "waiting_permission";
    });
  }
}

function evaluateTaskPermission(
  task: TaskRecord,
  rules: PermissionRuleRecord[],
): {
  effect: PermissionEffect;
  tool: string;
  action: string;
  risk_level: RiskLevel;
  reason: string;
  affected_paths: string[];
} {
  const classification = classifyTask(task.role, task.task);
  const matchingRule = findMatchingRule(task, classification.tool, classification.action, rules);
  return {
    ...classification,
    effect: matchingRule?.effect ?? defaultEffectForRisk(classification.risk_level),
  };
}

function classifyTask(role: WorkerRole, taskText: string): {
  tool: string;
  action: string;
  risk_level: RiskLevel;
  reason: string;
  affected_paths: string[];
} {
  const lower = taskText.toLowerCase();
  const dangerous = [
    "rm -rf",
    "sudo ",
    "curl ",
    "wget ",
    ".env",
    "~/.ssh",
    "/.ssh",
    ".git/",
  ].find((pattern) => lower.includes(pattern));
  if (dangerous) {
    return {
      tool: dangerous.includes(".env") || dangerous.includes("ssh") ? "Read" : "Bash",
      action: dangerous,
      risk_level: "danger",
      reason: "Task text references a high-risk operation or sensitive path.",
      affected_paths: [],
    };
  }

  const environment = ["npm install", "pnpm install", "yarn add", "pip install"].find((pattern) =>
    lower.includes(pattern),
  );
  if (environment) {
    return {
      tool: "Bash",
      action: environment,
      risk_level: "environment",
      reason: "Task may modify the project or user environment by installing dependencies.",
      affected_paths: inferAffectedPaths(taskText),
    };
  }

  if (role === "tester") {
    return {
      tool: "Bash",
      action: inferTestCommand(taskText),
      risk_level: "test",
      reason: "Tester worker needs approval to run project test commands.",
      affected_paths: inferAffectedPaths(taskText),
    };
  }

  if (role === "implementer") {
    return {
      tool: "Edit",
      action: "modify files in isolated worktree",
      risk_level: "safe_write",
      reason: "Implementer writes are allowed in an isolated worktree by default.",
      affected_paths: inferAffectedPaths(taskText),
    };
  }

  return {
    tool: "Read",
    action: role === "reviewer" ? "review patch and diff artifacts" : "read project structure",
    risk_level: "read",
    reason: "Read-only worker role.",
    affected_paths: inferAffectedPaths(taskText),
  };
}

function defaultEffectForRisk(risk: RiskLevel): PermissionEffect {
  if (risk === "danger") {
    return "deny";
  }
  if (risk === "test" || risk === "environment") {
    return "ask";
  }
  return "allow";
}

function findMatchingRule(
  task: TaskRecord,
  tool: string,
  action: string,
  rules: PermissionRuleRecord[],
): PermissionRuleRecord | undefined {
  return rules.find((rule) => {
    if (rule.project_id !== "*" && rule.project_id !== task.project_id) {
      return false;
    }
    if (rule.tool !== "*" && rule.tool !== tool) {
      return false;
    }
    if (rule.scope === "task" && rule.task_id !== task.id) {
      return false;
    }
    return patternMatches(rule.pattern, action);
  });
}

function patternMatches(pattern: string, value: string): boolean {
  if (pattern === value) {
    return true;
  }
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i").test(value);
}

function inferTestCommand(taskText: string): string {
  const match = taskText.match(
    /(python3? -m unittest[^\n;.]*|uv run pytest[^\n;.]*|pytest[^\n;.]*|npm test[^\n;.]*|pnpm test[^\n;.]*|yarn test[^\n;.]*)/i,
  );
  return match?.[1]?.trim() ?? "run project tests";
}

function inferAffectedPaths(taskText: string): string[] {
  const matches = taskText.match(/(?:src|tests|docs|examples)\/[A-Za-z0-9_./-]+/g);
  return Array.from(new Set(matches ?? []));
}
