#!/usr/bin/env node
import { readFile } from "node:fs/promises";

import { renderStatusDashboard, watchStatusDashboard } from "./dashboard/status_tui.js";
import { startMcpServer } from "./mcp/server.js";
import { normalizeMcpExposure } from "./mcp/exposure.js";
import { TOOL_CATALOG } from "./tools/tool_catalog.js";

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "mcp") {
    await startMcpServer(parseMcpArgs(args));
    return;
  }

  if (command === "status") {
    await runStatusCommand(args);
    return;
  }

  const result = await runCommand(command, args);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function parseMcpArgs(args: string[]): { exposure?: ReturnType<typeof normalizeMcpExposure> } {
  let exposure: ReturnType<typeof normalizeMcpExposure> | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];

    if (arg === "--exposure" || arg === "--mcp-exposure") {
      if (!next) {
        throw new Error(`${arg} requires compact or full.`);
      }
      exposure = normalizeMcpExposure(next);
      index += 1;
      continue;
    }

    if (arg === "--mode") {
      if (!next) {
        throw new Error("--mode requires supervisor or dev.");
      }
      exposure = next === "dev" ? "full" : "compact";
      index += 1;
      continue;
    }

    throw new Error(`Unknown mcp argument: ${arg}`);
  }

  return { exposure };
}

async function runCommand(command: string, args: string[]): Promise<unknown> {
  const entry = TOOL_CATALOG[command];
  if (!entry) {
    throw new Error(`Unknown command: ${command}`);
  }
  return entry.handler(await parseToolInput(args, entry.flags));
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
  process.stdout.write(`codex_lead_cc Phase 5 local CLI

Usage:
  node dist/index.js mcp
  node dist/index.js mcp --exposure <compact|full>
  node dist/index.js status [--project-id <project>] [--watch]
  node dist/index.js cc_dispatch --action <create_plan|assign_task|...>
  node dist/index.js cc_wait --project-id <project> [--timeout-sec 30]
  node dist/index.js cc_inspect --action <get_status|get_report|...>
  node dist/index.js cc_decide --action <approve_permission|stop_task|...>
  node dist/index.js cc_run_task --project-path <path> --task <task> [--timeout-sec 300]
  node dist/index.js cc_create_worker --role <scout|implementer|tester|reviewer> [--project-path <path>]
  node dist/index.js cc_assign_task --worker-id <ccw_001> --task <task> [--depends-on task_001,task_002]
  node dist/index.js cc_create_plan [--project-id <project>] --goal <goal>
  node dist/index.js cc_get_plan --plan-id <plan_001>
  node dist/index.js cc_get_status --task-id <task_001>
  node dist/index.js cc_get_status --worker-id <ccw_001>
  node dist/index.js cc_get_report --task-id <task_001>
  node dist/index.js cc_get_report --task-id <task_001> --level <summary|full|raw>
  node dist/index.js cc_set_supervisor_state --project-id <project> --state <active|waiting|sleeping>
  node dist/index.js cc_wait_for_events --project-id <project> [--timeout-sec 30]
  node dist/index.js cc_get_inbox [--project-id <project>] [--only-unread true]
  node dist/index.js cc_stop_task --task-id <task_001> [--reason <reason>]
  node dist/index.js cc_get_updates --since-event-id <1000>
  node dist/index.js cc_get_pending_permissions [--project-id <project>]
  node dist/index.js cc_approve_permission --request-id <perm_001> --decision <allow_once|allow_for_task|allow_for_project>
  node dist/index.js cc_reject_permission --request-id <perm_001> [--reason <reason>]
  node dist/index.js cc_get_diff_summary --task-id <task_001>
  node dist/index.js cc_get_diff_detail --task-id <task_001> --file <path>

All commands except mcp also support:
  --json '<json>'
  --json-file ./input.json
  --stdin

Commands:
  mcp                Start the MCP stdio server; compact exposes gateway tools only, full exposes all tools
  cc_dispatch        Gateway for planning, worker creation, and task dispatch
  cc_wait            Gateway for Supervisor Wait Mode
  cc_inspect         Gateway for status, reports, diffs, metrics, and inbox reads
  cc_decide          Gateway for approvals, stops, restarts, and state decisions
  cc_admin           Dev-mode admin gateway
  cc_run_task        Phase 0 compatible synchronous Claude Code run
  cc_create_worker   Create a lightweight Claude Code worker
  cc_assign_task     Assign a task and return immediately with task_id
  cc_get_status      Read task or worker status
  cc_get_report      Read a structured task report
  cc_set_supervisor_state
                     Set the Codex supervisor state for a project or plan
  cc_get_supervisor_state
                     Read the current supervisor state
  cc_wait_for_events Wait for wake-worthy events and return a lightweight wake packet
  cc_get_inbox       Read supervisor notifications
  cc_mark_notifications_read
                     Mark supervisor notifications as read
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

const numericFields = new Set([
  "timeout_sec",
  "since_event_id",
  "version",
  "idle_timeout_sec",
  "max_events",
  "max_notifications",
]);
const booleanFields = new Set(["all", "dry_run", "only_unread"]);
const arrayFields = new Set(["depends_on", "wake_on", "notification_ids"]);

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
