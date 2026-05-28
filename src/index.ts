#!/usr/bin/env node
import { readFile } from "node:fs/promises";

import { renderStatusDashboard, watchStatusDashboard } from "./dashboard/status_tui.js";
import { startMcpServer } from "./mcp/server.js";
import { ccApprovePermission } from "./tools/cc_approve_permission.js";
import { ccAssignTask } from "./tools/cc_assign_task.js";
import { ccCleanupIdleWorkers } from "./tools/cc_cleanup_idle_workers.js";
import { ccCleanupWorktree } from "./tools/cc_cleanup_worktree.js";
import { ccCreatePlan } from "./tools/cc_create_plan.js";
import { ccCreateWorker } from "./tools/cc_create_worker.js";
import { ccDeleteWorker } from "./tools/cc_delete_worker.js";
import { ccGetDiffDetail } from "./tools/cc_get_diff_detail.js";
import { ccGetDiffSummary } from "./tools/cc_get_diff_summary.js";
import { ccGetMetrics } from "./tools/cc_get_metrics.js";
import { ccGetPendingPermissions } from "./tools/cc_get_pending_permissions.js";
import { ccGetPlan } from "./tools/cc_get_plan.js";
import { ccGetReport } from "./tools/cc_get_report.js";
import { ccGetStatus } from "./tools/cc_get_status.js";
import { ccGetUpdates } from "./tools/cc_get_updates.js";
import { ccGetWorkerHealth } from "./tools/cc_get_worker_health.js";
import { ccListPlans } from "./tools/cc_list_plans.js";
import { ccListTasks } from "./tools/cc_list_tasks.js";
import { ccListWorkers } from "./tools/cc_list_workers.js";
import { ccRejectPermission } from "./tools/cc_reject_permission.js";
import { ccRestartWorker } from "./tools/cc_restart_worker.js";
import { ccRunTask } from "./tools/cc_run_task.js";
import { ccStopTask } from "./tools/cc_stop_task.js";
import { ccStopWorker } from "./tools/cc_stop_worker.js";
import { ccUpdatePlan } from "./tools/cc_update_plan.js";
import type {
  AssignTaskInput,
  ApprovePermissionInput,
  CcRunTaskInput,
  CleanupIdleWorkersInput,
  CleanupWorktreeInput,
  CreatePlanInput,
  CreateWorkerInput,
  DeleteWorkerInput,
  GetDiffDetailInput,
  GetDiffSummaryInput,
  GetPlanInput,
  GetWorkerHealthInput,
  ListPlansInput,
  GetPendingPermissionsInput,
  GetReportInput,
  GetStatusInput,
  GetUpdatesInput,
  ListTasksInput,
  ListWorkersInput,
  MetricsInput,
  RejectPermissionInput,
  RestartWorkerInput,
  StopTaskInput,
  StopWorkerInput,
  UpdatePlanInput,
} from "./types.js";

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "mcp") {
    await startMcpServer();
    return;
  }

  if (command === "status") {
    await runStatusCommand(args);
    return;
  }

  const result = await runCommand(command, args);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function runCommand(command: string, args: string[]): Promise<unknown> {
  switch (command) {
    case "cc_run_task":
      return ccRunTask(await parseToolInput<CcRunTaskInput>(args, {
        "--project-path": "project_path",
        "--task": "task",
        "--timeout-sec": "timeout_sec",
      }));
    case "cc_create_worker":
      return ccCreateWorker(await parseToolInput<CreateWorkerInput>(args, {
        "--project-path": "project_path",
        "--project-id": "project_id",
        "--role": "role",
        "--worktree-mode": "worktree_mode",
        "--runtime": "runtime",
        "--idle-timeout-sec": "idle_timeout_sec",
      }));
    case "cc_assign_task":
      return ccAssignTask(await parseToolInput<AssignTaskInput>(args, {
        "--worker-id": "worker_id",
        "--task": "task",
        "--timeout-sec": "timeout_sec",
        "--target-task-id": "target_task_id",
        "--depends-on": "depends_on",
        "--plan-id": "plan_id",
        "--plan-task-id": "plan_task_id",
      }));
    case "cc_get_status":
      return ccGetStatus(await parseToolInput<GetStatusInput>(args, {
        "--task-id": "task_id",
        "--worker-id": "worker_id",
        "--all": "all",
      }));
    case "cc_get_report":
      return ccGetReport(await parseToolInput<GetReportInput>(args, {
        "--task-id": "task_id",
      }));
    case "cc_stop_task":
      return ccStopTask(await parseToolInput<StopTaskInput>(args, {
        "--task-id": "task_id",
        "--reason": "reason",
      }));
    case "cc_stop_worker":
      return ccStopWorker(await parseToolInput<StopWorkerInput>(args, {
        "--worker-id": "worker_id",
        "--reason": "reason",
      }));
    case "cc_delete_worker":
      return ccDeleteWorker(await parseToolInput<DeleteWorkerInput>(args, {
        "--worker-id": "worker_id",
      }));
    case "cc_get_updates":
      return ccGetUpdates(await parseToolInput<GetUpdatesInput>(args, {
        "--since-event-id": "since_event_id",
        "--project-id": "project_id",
      }));
    case "cc_get_pending_permissions":
      return ccGetPendingPermissions(await parseToolInput<GetPendingPermissionsInput>(args, {
        "--project-id": "project_id",
      }));
    case "cc_approve_permission":
      return ccApprovePermission(await parseToolInput<ApprovePermissionInput>(args, {
        "--request-id": "request_id",
        "--decision": "decision",
      }));
    case "cc_reject_permission":
      return ccRejectPermission(await parseToolInput<RejectPermissionInput>(args, {
        "--request-id": "request_id",
        "--reason": "reason",
      }));
    case "cc_get_diff_summary":
      return ccGetDiffSummary(await parseToolInput<GetDiffSummaryInput>(args, {
        "--task-id": "task_id",
      }));
    case "cc_get_diff_detail":
      return ccGetDiffDetail(await parseToolInput<GetDiffDetailInput>(args, {
        "--task-id": "task_id",
        "--file": "file",
      }));
    case "cc_list_workers":
      return ccListWorkers(await parseToolInput<ListWorkersInput>(args, {
        "--project-id": "project_id",
        "--status": "status",
      }));
    case "cc_list_tasks":
      return ccListTasks(await parseToolInput<ListTasksInput>(args, {
        "--project-id": "project_id",
        "--status": "status",
        "--worker-id": "worker_id",
      }));
    case "cc_cleanup_worktree":
      return ccCleanupWorktree(await parseToolInput<CleanupWorktreeInput>(args, {
        "--task-id": "task_id",
        "--worker-id": "worker_id",
      }));
    case "cc_create_plan":
      return ccCreatePlan(await parseToolInput<CreatePlanInput>(args, {
        "--project-id": "project_id",
        "--goal": "goal",
      }));
    case "cc_get_plan":
      return ccGetPlan(await parseToolInput<GetPlanInput>(args, {
        "--plan-id": "plan_id",
        "--version": "version",
      }));
    case "cc_update_plan":
      return ccUpdatePlan(await parseToolInput<UpdatePlanInput>(args, {
        "--plan-id": "plan_id",
        "--reason": "reason",
        "--status": "status",
        "--goal": "goal",
      }));
    case "cc_list_plans":
      return ccListPlans(await parseToolInput<ListPlansInput>(args, {
        "--project-id": "project_id",
        "--status": "status",
      }));
    case "cc_get_metrics":
      return ccGetMetrics(await parseToolInput<MetricsInput>(args, {
        "--project-id": "project_id",
        "--plan-id": "plan_id",
      }));
    case "cc_restart_worker":
      return ccRestartWorker(await parseToolInput<RestartWorkerInput>(args, {
        "--worker-id": "worker_id",
        "--reason": "reason",
      }));
    case "cc_get_worker_health":
      return ccGetWorkerHealth(await parseToolInput<GetWorkerHealthInput>(args, {
        "--worker-id": "worker_id",
        "--project-id": "project_id",
      }));
    case "cc_cleanup_idle_workers":
      return ccCleanupIdleWorkers(await parseToolInput<CleanupIdleWorkersInput>(args, {
        "--project-id": "project_id",
        "--idle-timeout-sec": "idle_timeout_sec",
        "--dry-run": "dry_run",
      }));
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

async function runStatusCommand(args: string[]): Promise<void> {
  let projectId: string | undefined;
  let watch = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--project-id") {
      if (!next) {
        throw new Error("--project-id requires a value.");
      }
      projectId = next;
      index += 1;
      continue;
    }
    if (arg === "--watch") {
      watch = true;
      continue;
    }
    throw new Error(`Unknown status argument: ${arg}`);
  }

  if (watch) {
    await watchStatusDashboard(projectId);
    return;
  }

  process.stdout.write(await renderStatusDashboard(projectId));
}

async function parseToolInput<T>(
  args: string[],
  flagMap: Record<string, string>,
): Promise<T> {
  const parsed: Record<string, unknown> = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];

    if (arg === "--stdin") {
      return parseJsonInput(await readStdin());
    }

    if (arg === "--json") {
      if (!next) {
        throw new Error("--json requires a JSON string value.");
      }
      index += 1;
      return parseJsonInput(next);
    }

    if (arg === "--json-file") {
      if (!next) {
        throw new Error("--json-file requires a file path.");
      }
      index += 1;
      return parseJsonInput(await readFile(next, "utf8"));
    }

    const fieldName = flagMap[arg];
    if (fieldName) {
      if (!next) {
        throw new Error(`${arg} requires a value.`);
      }
      index += 1;
      parsed[fieldName] = numericFields.has(fieldName)
        ? Number(next)
        : arrayFields.has(fieldName)
          ? next.split(",").map((item) => item.trim()).filter(Boolean)
        : booleanFields.has(fieldName)
          ? next === "true"
          : next;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed as T;
}

function parseJsonInput<T>(raw: string): T {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("JSON input must be an object.");
  }
  return parsed as T;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function printHelp(): void {
  process.stdout.write(`codex_lead_cc Phase 3 local CLI

Usage:
  codex-lead-cc mcp
  codex-lead-cc status [--project-id <project>] [--watch]
  codex-lead-cc cc_run_task --project-path <path> --task <task> [--timeout-sec 300]
  codex-lead-cc cc_create_worker --project-path <path> --role <scout|implementer|tester|reviewer>
  codex-lead-cc cc_assign_task --worker-id <ccw_001> --task <task> [--depends-on task_001,task_002]
  codex-lead-cc cc_create_plan --project-id <project> --goal <goal>
  codex-lead-cc cc_get_plan --plan-id <plan_001>
  codex-lead-cc cc_get_status --task-id <task_001>
  codex-lead-cc cc_get_status --worker-id <ccw_001>
  codex-lead-cc cc_get_report --task-id <task_001>
  codex-lead-cc cc_stop_task --task-id <task_001> [--reason <reason>]
  codex-lead-cc cc_get_updates --since-event-id <1000>
  codex-lead-cc cc_get_pending_permissions [--project-id <project>]
  codex-lead-cc cc_approve_permission --request-id <perm_001> --decision <allow_once|allow_for_task|allow_for_project>
  codex-lead-cc cc_reject_permission --request-id <perm_001> [--reason <reason>]
  codex-lead-cc cc_get_diff_summary --task-id <task_001>
  codex-lead-cc cc_get_diff_detail --task-id <task_001> --file <path>

All commands except mcp also support:
  --json '<json>'
  --json-file ./input.json
  --stdin

Commands:
  mcp                Start the MCP stdio server
  cc_run_task        Phase 0 compatible synchronous Claude Code run
  cc_create_worker   Create a lightweight Claude Code worker
  cc_assign_task     Assign a task and return immediately with task_id
  cc_get_status      Read task or worker status
  cc_get_report      Read a structured task report
  cc_stop_task       Stop a running task
  cc_stop_worker     Stop a worker and its current task
  cc_delete_worker   Delete an idle/stopped worker
  cc_get_updates     Read event log updates
  cc_get_pending_permissions
                     List permission requests waiting for supervisor approval
  cc_approve_permission
                     Approve a permission request
  cc_reject_permission
                     Reject a permission request
  cc_get_diff_summary
                     Read patch summary for an implementer task
  cc_get_diff_detail Read per-file diff for an implementer task
  cc_create_plan     Create a supervisor plan with version history
  cc_get_plan        Read active or historical plan version
  cc_update_plan     Update a plan with a change reason
  cc_list_plans      List plans
  cc_get_metrics     Compute plan/project metrics
  cc_restart_worker  Restart a worker session
  cc_get_worker_health
                     Read worker health/session status
  cc_cleanup_idle_workers
                     Stop idle worker sessions
  status             Render a local status dashboard
  cc_list_workers    List workers
  cc_list_tasks      List tasks
  cc_cleanup_worktree
                     Remove managed worktrees
`);
}

const numericFields = new Set(["timeout_sec", "since_event_id", "version", "idle_timeout_sec"]);
const booleanFields = new Set(["all", "dry_run"]);
const arrayFields = new Set(["depends_on"]);

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
