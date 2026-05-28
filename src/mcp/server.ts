import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";

import { ccApprovePermission } from "../tools/cc_approve_permission.js";
import { ccAssignTask } from "../tools/cc_assign_task.js";
import { ccCleanupWorktree } from "../tools/cc_cleanup_worktree.js";
import { ccCreateWorker } from "../tools/cc_create_worker.js";
import { ccDeleteWorker } from "../tools/cc_delete_worker.js";
import { ccGetDiffDetail } from "../tools/cc_get_diff_detail.js";
import { ccGetDiffSummary } from "../tools/cc_get_diff_summary.js";
import { ccGetPendingPermissions } from "../tools/cc_get_pending_permissions.js";
import { ccGetReport } from "../tools/cc_get_report.js";
import { ccGetStatus } from "../tools/cc_get_status.js";
import { ccGetUpdates } from "../tools/cc_get_updates.js";
import { ccListTasks } from "../tools/cc_list_tasks.js";
import { ccListWorkers } from "../tools/cc_list_workers.js";
import { ccRejectPermission } from "../tools/cc_reject_permission.js";
import { ccStopTask } from "../tools/cc_stop_task.js";
import { ccStopWorker } from "../tools/cc_stop_worker.js";

export async function startMcpServer(): Promise<void> {
  const server = new McpServer({
    name: "codex_lead_cc",
    version: "0.3.0",
  });

  server.registerTool(
    "cc_create_worker",
    {
      title: "Create Claude Code Worker",
      description: "Create a lightweight Claude Code worker bound to a project path and role.",
      inputSchema: {
        project_path: z.string().min(1),
        project_id: z.string().min(1).optional(),
        role: z.enum(["scout", "implementer", "tester", "reviewer"]),
        worktree_mode: z.enum(["readonly", "isolated", "direct"]).optional(),
      },
    },
    async (input) => toolResult(await ccCreateWorker(input)),
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
      },
    },
    async (input) => toolResult(await ccAssignTask(input)),
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
    async (input) => toolResult(await ccGetStatus(input)),
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
    async (input) => toolResult(await ccGetReport(input)),
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
    async (input) => toolResult(await ccStopTask(input)),
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
    async (input) => toolResult(await ccStopWorker(input)),
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
    async (input) => toolResult(await ccDeleteWorker(input)),
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
    async (input) => toolResult(await ccGetUpdates(input)),
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
    async (input) => toolResult(await ccGetPendingPermissions(input)),
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
    async (input) => toolResult(await ccApprovePermission(input)),
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
    async (input) => toolResult(await ccRejectPermission(input)),
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
    async (input) => toolResult(await ccGetDiffSummary(input)),
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
    async (input) => toolResult(await ccGetDiffDetail(input)),
  );

  server.registerTool(
    "cc_list_workers",
    {
      title: "List Workers",
      description: "List workers by optional project or status.",
      inputSchema: {
        project_id: z.string().min(1).optional(),
        status: z.enum(["idle", "pending", "running", "stopped"]).optional(),
      },
    },
    async (input) => toolResult(await ccListWorkers(input)),
  );

  server.registerTool(
    "cc_list_tasks",
    {
      title: "List Tasks",
      description: "List tasks by optional project, worker, or status.",
      inputSchema: {
        project_id: z.string().min(1).optional(),
        status: z
          .enum(["pending", "waiting_permission", "running", "completed", "failed", "timeout", "stopped"])
          .optional(),
        worker_id: z.string().min(1).optional(),
      },
    },
    async (input) => toolResult(await ccListTasks(input)),
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
    async (input) => toolResult(await ccCleanupWorktree(input)),
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("codex_lead_cc MCP server running on stdio.");
}

function toolResult(result: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(result, null, 2),
      },
    ],
    structuredContent: result as Record<string, unknown>,
  };
}
