#!/usr/bin/env node
import { writeFile } from "node:fs/promises";

import { startClaudeTask } from "../claude/claude_runtime_adapter.js";
import { buildTaskReport, summarizeTaskReport } from "../report/build_report.js";
import type { ClaudeCliRunResult, FinalTaskStatus, TaskRecord } from "../types.js";
import { createRuntime } from "./runtime.js";
import { syncLinkedPlanTask } from "./plan_state.js";
import { appendEvent, nowIso, StateStore } from "./state_store.js";
import { setWorkerTaskState } from "./worker_state.js";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const runtime = createRuntime(args.stateDir);
  const store = runtime.store;
  const state = await store.readState();
  const task = state.tasks[args.taskId];
  if (!task) {
    throw new Error(`Task not found: ${args.taskId}`);
  }

  let execution;
  try {
    execution = await runtime.worktrees.prepareTaskExecution(task);
  } catch (error) {
    await failTaskBeforeRun(store, task, error);
    await runtime.scheduler.schedule();
    return;
  }

  await store.updateState((latest) => {
    const latestTask = latest.tasks[task.id];
    if (latestTask) {
      latestTask.execution_path = execution.executionPath;
      latestTask.worktree_path = execution.worktreePath;
      latestTask.worktree_mode = execution.worktreeMode;
      latestTask.base_branch = execution.baseBranch;
      latestTask.updated_at = nowIso();
      syncLinkedPlanTask(latest, latestTask);
    }
  });

  const runtimeTask = await startClaudeTask(store, {
    task,
    prompt: buildRolePrompt(task),
    execution_path: execution.executionPath,
  });
  const { running } = runtimeTask;

  const startedAt = nowIso();
  await store.updateState((latest) => {
    const latestTask = latest.tasks[task.id];
    if (!latestTask) {
      throw new Error(`Task not found after runner start: ${task.id}`);
    }
    latestTask.status = "running";
    latestTask.started_at = latestTask.started_at ?? startedAt;
    latestTask.updated_at = startedAt;
    latestTask.claude_pid = running.pid;
    latestTask.runtime = runtimeTask.runtime;
    syncLinkedPlanTask(latest, latestTask);

    const worker = latest.workers[latestTask.worker_id];
    if (worker) {
      setWorkerTaskState({ state: latest, worker, status: "running", timestamp: startedAt, currentTaskId: latestTask.id });
    }
  });

  const stopFromSignal = (signal: NodeJS.Signals) => {
    running.stop(`Task worker received ${signal}.`);
  };
  process.once("SIGTERM", () => stopFromSignal("SIGTERM"));
  process.once("SIGINT", () => stopFromSignal("SIGINT"));

  const result = await running.finished;
  await finalizeTask(runtime, task.id, result);
}

async function finalizeTask(
  runtime: ReturnType<typeof createRuntime>,
  taskId: string,
  result: ClaudeCliRunResult,
): Promise<void> {
  const store = runtime.store;
  const state = await store.readState();
  const task = state.tasks[taskId];
  if (!task) {
    throw new Error(`Task not found while finalizing: ${taskId}`);
  }

  const finalStatus: FinalTaskStatus = task.status === "stopped" ? "stopped" : result.status;
  let diffSummary;
  if (finalStatus === "completed" && task.role === "implementer") {
    diffSummary = await runtime.diffs.createDiffArtifacts(task);
  }
  const latestState = await store.readState();
  const latestTask = latestState.tasks[taskId] ?? task;
  const stdout = result.stdout;
  const stderr = result.stderr;
  const summary = summarizeTaskReport(finalStatus, stdout, stderr);
  const report = buildTaskReport({
    task: {
      ...latestTask,
      status: finalStatus,
      started_at: latestTask.started_at ?? result.startedAt.toISOString(),
      finished_at: result.finishedAt.toISOString(),
      duration_ms: result.durationMs,
      exit_code: result.exitCode,
    },
    result: {
      ...result,
      status: finalStatus,
    },
    stdout,
    stderr,
    status: finalStatus,
    summary,
    diffSummary,
  });

  const paths = store.taskPaths(latestTask.id);
  await writeFile(paths.reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  const finishedAt = result.finishedAt.toISOString();
  await store.updateState((latest) => {
    const latestTaskRecord = latest.tasks[task.id];
    if (!latestTaskRecord) {
      throw new Error(`Task not found while saving final state: ${task.id}`);
    }
    latestTaskRecord.status = finalStatus;
    latestTaskRecord.exit_code = result.exitCode;
    latestTaskRecord.error = result.error;
    latestTaskRecord.summary = summary;
    latestTaskRecord.started_at = latestTaskRecord.started_at ?? result.startedAt.toISOString();
    latestTaskRecord.finished_at = finishedAt;
    latestTaskRecord.duration_ms = result.durationMs;
    latestTaskRecord.updated_at = finishedAt;
    delete latestTaskRecord.claude_pid;
    syncLinkedPlanTask(latest, latestTaskRecord);

    const worker = latest.workers[latestTaskRecord.worker_id];
    if (worker && worker.current_task_id === latestTaskRecord.id) {
      setWorkerTaskState({
        state: latest,
        worker,
        status: worker.status === "stopped" ? "stopped" : "idle",
        timestamp: finishedAt,
      });
    }
    appendEvent(latest, {
      type: eventTypeForStatus(finalStatus),
      project_id: latestTaskRecord.project_id,
      task_id: latestTaskRecord.id,
      worker_id: latestTaskRecord.worker_id,
      summary: `Task ${latestTaskRecord.id} ${finalStatus}.`,
      payload: { exit_code: result.exitCode },
    });
    latest.counters.artifact += 1;
    const artifactId = `art_${latest.counters.artifact.toString().padStart(3, "0")}`;
    latest.artifacts[artifactId] = {
      id: artifactId,
      project_id: latestTaskRecord.project_id,
      task_id: latestTaskRecord.id,
      type: "report",
      path: paths.displayReportPath,
      created_at: finishedAt,
    };
    appendEvent(latest, {
      type: "report_created",
      project_id: latestTaskRecord.project_id,
      task_id: latestTaskRecord.id,
      worker_id: latestTaskRecord.worker_id,
      summary: `Report created for task ${latestTaskRecord.id}.`,
      payload: { report_id: artifactId, report_path: paths.displayReportPath },
    });
  });

  await runtime.scheduler.schedule();
}

async function failTaskBeforeRun(store: StateStore, task: TaskRecord, error: unknown): Promise<void> {
  const timestamp = nowIso();
  const message = error instanceof Error ? error.message : String(error);
  const report = buildTaskReport({
    task: {
      ...task,
      status: "failed",
      started_at: timestamp,
      finished_at: timestamp,
      duration_ms: 0,
      error: message,
    },
    stdout: "",
    stderr: message,
    status: "failed",
    summary: `Task failed before Claude Code started: ${message}`,
  });
  const paths = store.taskPaths(task.id);
  await writeFile(paths.reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await store.updateState((state) => {
    const latestTask = state.tasks[task.id];
    if (latestTask) {
      latestTask.status = "failed";
      latestTask.error = message;
      latestTask.started_at = timestamp;
      latestTask.finished_at = timestamp;
      latestTask.duration_ms = 0;
      latestTask.updated_at = timestamp;
      syncLinkedPlanTask(state, latestTask);
    }
    const worker = state.workers[task.worker_id];
    if (worker && worker.current_task_id === task.id) {
      setWorkerTaskState({ state, worker, status: "idle", timestamp });
    }
    appendEvent(state, {
      type: "task_failed",
      project_id: task.project_id,
      task_id: task.id,
      worker_id: task.worker_id,
      summary: `Task ${task.id} failed before start.`,
      payload: { error: message },
    });
  });
}

function buildRolePrompt(task: TaskRecord): string {
  const boundaries = [
    `You are a Claude Code worker managed by codex_lead_cc.`,
    `Worker role: ${task.role}.`,
    `Return a concise, structured report for the supervisor.`,
  ];

  if (task.role === "scout") {
    boundaries.push("Read only. Do not edit files or run mutating commands.");
  }
  if (task.role === "implementer") {
    boundaries.push("Implement changes only in the current working tree. Do not merge or commit.");
  }
  if (task.role === "tester") {
    boundaries.push("Run only the test command needed for this task and summarize commands_run and test_result.");
  }
  if (task.role === "reviewer") {
    boundaries.push("Review only the supplied patch/diff artifacts and report decision, findings, and risks.");
    if (task.target_task_id) {
      boundaries.push(`Review target task: ${task.target_task_id}.`);
    }
  }

  return `${boundaries.join("\n")}\n\nTask:\n${task.task}`;
}

function eventTypeForStatus(status: FinalTaskStatus) {
  if (status === "completed") {
    return "task_completed" as const;
  }
  if (status === "timeout") {
    return "task_timeout" as const;
  }
  if (status === "stopped") {
    return "task_stopped" as const;
  }
  return "task_failed" as const;
}

function parseArgs(args: string[]): { taskId: string; stateDir: string } {
  let taskId: string | undefined;
  let stateDir: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];

    if (arg === "--task-id") {
      if (!next) {
        throw new Error("--task-id requires a value.");
      }
      taskId = next;
      index += 1;
      continue;
    }

    if (arg === "--state-dir") {
      if (!next) {
        throw new Error("--state-dir requires a value.");
      }
      stateDir = next;
      index += 1;
      continue;
    }

    throw new Error(`Unknown task worker argument: ${arg}`);
  }

  if (!taskId) {
    throw new Error("--task-id is required.");
  }
  if (!stateDir) {
    throw new Error("--state-dir is required.");
  }

  return { taskId, stateDir };
}

main().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
