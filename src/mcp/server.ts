import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";

import { ccApprovePermission } from "../tools/cc_approve_permission.js";
import { ccAssignTask } from "../tools/cc_assign_task.js";
import { ccCleanupIdleWorkers } from "../tools/cc_cleanup_idle_workers.js";
import { ccCleanupWorktree } from "../tools/cc_cleanup_worktree.js";
import { ccCreatePlan } from "../tools/cc_create_plan.js";
import { ccCreateWorker } from "../tools/cc_create_worker.js";
import { ccDeleteWorker } from "../tools/cc_delete_worker.js";
import { ccGetDiffDetail } from "../tools/cc_get_diff_detail.js";
import { ccGetDiffSummary } from "../tools/cc_get_diff_summary.js";
import { ccGetMetrics } from "../tools/cc_get_metrics.js";
import { ccGetPendingPermissions } from "../tools/cc_get_pending_permissions.js";
import { ccGetPlan } from "../tools/cc_get_plan.js";
import { ccGetReport } from "../tools/cc_get_report.js";
import { ccGetStatus } from "../tools/cc_get_status.js";
import { ccGetUpdates } from "../tools/cc_get_updates.js";
import { ccGetWorkerHealth } from "../tools/cc_get_worker_health.js";
import { ccListPlans } from "../tools/cc_list_plans.js";
import { ccListTasks } from "../tools/cc_list_tasks.js";
import { ccListWorkers } from "../tools/cc_list_workers.js";
import { ccRejectPermission } from "../tools/cc_reject_permission.js";
import { ccRestartWorker } from "../tools/cc_restart_worker.js";
import { ccStopTask } from "../tools/cc_stop_task.js";
import { ccStopWorker } from "../tools/cc_stop_worker.js";
import { ccUpdatePlan } from "../tools/cc_update_plan.js";
import { TASK_STATUSES, WORKER_ROLES, WORKER_RUNTIMES, WORKER_STATUSES } from "../types.js";
import { mcpJsonResult } from "./tool_result.js";

const PLAN_STATUSES = ["active", "completed", "archived"] as const;
const PLAN_TASK_STATUSES = ["planned", ...TASK_STATUSES] as const;

export async function startMcpServer(): Promise<void> {
  const server = new McpServer({
    name: "codex_lead_cc",
    version: "0.4.0",
  });

  server.registerTool(
    "cc_create_worker",
    {
      title: "Create Claude Code Worker",
      description: "Create a lightweight Claude Code worker bound to a project path and role.",
      inputSchema: {
        project_path: z.string().min(1),
        project_id: z.string().min(1).optional(),
        role: z.enum(WORKER_ROLES),
        worktree_mode: z.enum(["readonly", "isolated", "direct"]).optional(),
        runtime: z.enum(WORKER_RUNTIMES).optional(),
        idle_timeout_sec: z.number().int().positive().optional(),
      },
    },
    async (input) => mcpJsonResult(await ccCreateWorker(input)),
  );

  server.registerTool(
    "cc_assign_task",
    {
      title: "Assign Task",
      description:
        "Assign a task to a worker and start Claude Code asynchronously. Returns immediately with task_id.",
      inputSchema: {
        worker_id: z.string().min(1),
        task: z.string().min(1),
        timeout_sec: z.number().int().positive().optional(),
        target_task_id: z.string().min(1).optional(),
        depends_on: z.array(z.string().min(1)).optional(),
        plan_id: z.string().min(1).optional(),
        plan_task_id: z.string().min(1).optional(),
      },
    },
    async (input) => mcpJsonResult(await ccAssignTask(input)),
  );

  server.registerTool(
    "cc_get_status",
    {
      title: "Get Status",
      description: "Get current task or worker status.",
      inputSchema: {
        task_id: z.string().min(1).optional(),
        worker_id: z.string().min(1).optional(),
        all: z.boolean().optional(),
      },
    },
    async (input) => mcpJsonResult(await ccGetStatus(input)),
  );

  server.registerTool(
    "cc_get_report",
    {
      title: "Get Report",
      description: "Get a structured task report. Running tasks return a partial report.",
      inputSchema: {
        task_id: z.string().min(1),
      },
    },
    async (input) => mcpJsonResult(await ccGetReport(input)),
  );

  server.registerTool(
    "cc_stop_task",
    {
      title: "Stop Task",
      description: "Stop a running task by task_id.",
      inputSchema: {
        task_id: z.string().min(1),
        reason: z.string().optional(),
      },
    },
    async (input) => mcpJsonResult(await ccStopTask(input)),
  );

  server.registerTool(
    "cc_stop_worker",
    {
      title: "Stop Worker",
      description: "Stop a worker and its current task if one is running.",
      inputSchema: {
        worker_id: z.string().min(1),
        reason: z.string().optional(),
      },
    },
    async (input) => mcpJsonResult(await ccStopWorker(input)),
  );

  server.registerTool(
    "cc_delete_worker",
    {
      title: "Delete Worker",
      description: "Delete an idle or stopped worker from local state.",
      inputSchema: {
        worker_id: z.string().min(1),
      },
    },
    async (input) => mcpJsonResult(await ccDeleteWorker(input)),
  );

  server.registerTool(
    "cc_get_updates",
    {
      title: "Get Updates",
      description: "Get event log entries after since_event_id.",
      inputSchema: {
        since_event_id: z.number().int().nonnegative().optional(),
        project_id: z.string().min(1).optional(),
      },
    },
    async (input) => mcpJsonResult(await ccGetUpdates(input)),
  );

  server.registerTool(
    "cc_get_pending_permissions",
    {
      title: "Get Pending Permissions",
      description: "List permission requests waiting for supervisor approval.",
      inputSchema: {
        project_id: z.string().min(1).optional(),
      },
    },
    async (input) => mcpJsonResult(await ccGetPendingPermissions(input)),
  );

  server.registerTool(
    "cc_approve_permission",
    {
      title: "Approve Permission",
      description: "Approve a permission request and optionally remember an allow rule.",
      inputSchema: {
        request_id: z.string().min(1),
        decision: z.enum(["allow_once", "allow_for_task", "allow_for_project"]),
      },
    },
    async (input) => mcpJsonResult(await ccApprovePermission(input)),
  );

  server.registerTool(
    "cc_reject_permission",
    {
      title: "Reject Permission",
      description: "Reject a permission request.",
      inputSchema: {
        request_id: z.string().min(1),
        reason: z.string().optional(),
      },
    },
    async (input) => mcpJsonResult(await ccRejectPermission(input)),
  );

  server.registerTool(
    "cc_get_diff_summary",
    {
      title: "Get Diff Summary",
      description: "Read a structured diff summary for an implementer task.",
      inputSchema: {
        task_id: z.string().min(1),
      },
    },
    async (input) => mcpJsonResult(await ccGetDiffSummary(input)),
  );

  server.registerTool(
    "cc_get_diff_detail",
    {
      title: "Get Diff Detail",
      description: "Read the patch diff for one file. Does not return full source files.",
      inputSchema: {
        task_id: z.string().min(1),
        file: z.string().min(1),
      },
    },
    async (input) => mcpJsonResult(await ccGetDiffDetail(input)),
  );

  server.registerTool(
    "cc_list_workers",
    {
      title: "List Workers",
      description: "List workers by optional project or status.",
      inputSchema: {
        project_id: z.string().min(1).optional(),
        status: z.enum(WORKER_STATUSES).optional(),
      },
    },
    async (input) => mcpJsonResult(await ccListWorkers(input)),
  );

  server.registerTool(
    "cc_list_tasks",
    {
      title: "List Tasks",
      description: "List tasks by optional project, worker, or status.",
      inputSchema: {
        project_id: z.string().min(1).optional(),
        status: z
          .enum(TASK_STATUSES)
          .optional(),
        worker_id: z.string().min(1).optional(),
      },
    },
    async (input) => mcpJsonResult(await ccListTasks(input)),
  );

  server.registerTool(
    "cc_cleanup_worktree",
    {
      title: "Cleanup Worktree",
      description: "Remove managed task worktrees.",
      inputSchema: {
        task_id: z.string().min(1).optional(),
        worker_id: z.string().min(1).optional(),
      },
    },
    async (input) => mcpJsonResult(await ccCleanupWorktree(input)),
  );

  server.registerTool(
    "cc_create_plan",
    {
      title: "Create Plan",
      description: "Create a supervisor plan with versioned task nodes.",
      inputSchema: {
        project_id: z.string().min(1),
        goal: z.string().min(1),
        tasks: z
          .array(
            z.object({
              role: z.enum(WORKER_ROLES),
              goal: z.string().min(1),
              depends_on: z.array(z.string().min(1)).optional(),
              worker_id: z.string().min(1).optional(),
              task_id: z.string().min(1).optional(),
            }),
          )
          .optional(),
      },
    },
    async (input) => mcpJsonResult(await ccCreatePlan(input)),
  );

  server.registerTool(
    "cc_get_plan",
    {
      title: "Get Plan",
      description: "Get the active plan or a historical plan version.",
      inputSchema: {
        plan_id: z.string().min(1),
        version: z.number().int().positive().optional(),
      },
    },
    async (input) => mcpJsonResult(await ccGetPlan(input)),
  );

  server.registerTool(
    "cc_update_plan",
    {
      title: "Update Plan",
      description: "Update a plan and record a change reason.",
      inputSchema: {
        plan_id: z.string().min(1),
        reason: z.string().min(1),
        goal: z.string().min(1).optional(),
        status: z.enum(PLAN_STATUSES).optional(),
        add_tasks: z
          .array(
            z.object({
              role: z.enum(WORKER_ROLES),
              goal: z.string().min(1),
              depends_on: z.array(z.string().min(1)).optional(),
              worker_id: z.string().min(1).optional(),
              task_id: z.string().min(1).optional(),
            }),
          )
          .optional(),
        update_tasks: z
          .array(
            z.object({
              plan_task_id: z.string().min(1),
              goal: z.string().min(1).optional(),
              status: z.enum(PLAN_TASK_STATUSES).optional(),
              depends_on: z.array(z.string().min(1)).optional(),
              worker_id: z.string().min(1).optional(),
              task_id: z.string().min(1).optional(),
            }),
          )
          .optional(),
        remove_tasks: z.array(z.string().min(1)).optional(),
      },
    },
    async (input) => mcpJsonResult(await ccUpdatePlan(input)),
  );

  server.registerTool(
    "cc_list_plans",
    {
      title: "List Plans",
      description: "List plans by optional project or status.",
      inputSchema: {
        project_id: z.string().min(1).optional(),
        status: z.enum(PLAN_STATUSES).optional(),
      },
    },
    async (input) => mcpJsonResult(await ccListPlans(input)),
  );

  server.registerTool(
    "cc_get_metrics",
    {
      title: "Get Metrics",
      description: "Compute project or plan metrics from local logs, reports, tasks, and permissions.",
      inputSchema: {
        project_id: z.string().min(1).optional(),
        plan_id: z.string().min(1).optional(),
      },
    },
    async (input) => mcpJsonResult(await ccGetMetrics(input)),
  );

  server.registerTool(
    "cc_restart_worker",
    {
      title: "Restart Worker",
      description: "Restart a stopped or crashed worker session.",
      inputSchema: {
        worker_id: z.string().min(1),
        reason: z.string().optional(),
      },
    },
    async (input) => mcpJsonResult(await ccRestartWorker(input)),
  );

  server.registerTool(
    "cc_get_worker_health",
    {
      title: "Get Worker Health",
      description: "Read worker health and session metadata.",
      inputSchema: {
        worker_id: z.string().min(1).optional(),
        project_id: z.string().min(1).optional(),
      },
    },
    async (input) => mcpJsonResult(await ccGetWorkerHealth(input)),
  );

  server.registerTool(
    "cc_cleanup_idle_workers",
    {
      title: "Cleanup Idle Workers",
      description: "Stop worker sessions that have been idle beyond their timeout.",
      inputSchema: {
        project_id: z.string().min(1).optional(),
        idle_timeout_sec: z.number().int().positive().optional(),
        dry_run: z.boolean().optional(),
      },
    },
    async (input) => mcpJsonResult(await ccCleanupIdleWorkers(input)),
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("codex_lead_cc MCP server running on stdio.");
}
