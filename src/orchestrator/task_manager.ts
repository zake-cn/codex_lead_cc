import { readFile, writeFile } from "node:fs/promises";

import { buildTaskReport, summarizeTaskReport } from "../report/build_report.js";
import type {
  AssignTaskInput,
  GetReportInput,
  GetStatusInput,
  ListTasksInput,
  StopTaskInput,
  TaskRecord,
  TaskReport,
  TaskStatus,
} from "../types.js";
import { appendEvent, nextId, nowIso, StateStore } from "./state_store.js";
import { ProcessManager } from "./process_manager.js";
import { PermissionEngine } from "./permission_engine.js";
import { Scheduler } from "./scheduler.js";

const DEFAULT_TIMEOUT_SEC = 300;
const MAX_TIMEOUT_SEC = 3_600;
const FINAL_STATUSES = new Set<TaskStatus>(["completed", "failed", "timeout", "stopped"]);

export class TaskManager {
  constructor(
    private readonly store: StateStore,
    private readonly processManager: ProcessManager,
    private readonly permissionEngine: PermissionEngine,
    private readonly scheduler: Scheduler,
  ) {}

  async assignTask(input: AssignTaskInput): Promise<{
    task_id: string;
    worker_id: string;
      status: TaskStatus;
  }> {
    const timeoutSec = normalizeTimeout(input.timeout_sec);
    const taskText = normalizeTask(input.task);
    const timestamp = nowIso();

    const createdTask = await this.store.updateState((state) => {
      const worker = state.workers[input.worker_id];
      if (!worker) {
        throw new Error(`Worker not found: ${input.worker_id}`);
      }
      if (worker.status === "running" || worker.status === "pending" || worker.current_task_id) {
        throw new Error(`Worker ${worker.id} is already running task ${worker.current_task_id}.`);
      }
      if (worker.status === "stopped") {
        throw new Error(`Worker ${worker.id} is stopped. Create a new worker before assigning tasks.`);
      }

      state.counters.task += 1;
      const id = nextId("task", state.counters.task);
      const paths = this.store.taskPaths(id);
      const taskRecord: TaskRecord = {
        id,
        worker_id: worker.id,
        role: worker.role,
        project_id: worker.project_id,
        project_path: worker.project_path,
        execution_path: worker.project_path,
        target_task_id: input.target_task_id,
        task: taskText,
        status: "pending",
        timeout_sec: timeoutSec,
        exit_code: null,
        log_path: paths.displayLogPath,
        report_path: paths.displayReportPath,
        stdout_path: paths.displayStdoutPath,
        stderr_path: paths.displayStderrPath,
        patch_path: paths.displayPatchPath,
        diff_summary_path: paths.displayDiffSummaryPath,
        worktree_mode: worker.worktree_mode ?? defaultWorktreeMode(worker.role),
        report_type: reportTypeForRole(worker.role),
        created_at: timestamp,
        updated_at: timestamp,
      };

      state.tasks[id] = taskRecord;
      worker.status = "pending";
      worker.current_task_id = id;
      worker.updated_at = timestamp;
      appendEvent(state, {
        type: "task_created",
        project_id: taskRecord.project_id,
        task_id: taskRecord.id,
        worker_id: worker.id,
        summary: `Created ${worker.role} task ${taskRecord.id}.`,
        payload: { target_task_id: input.target_task_id },
      });
      appendEvent(state, {
        type: "task_queued",
        project_id: taskRecord.project_id,
        task_id: taskRecord.id,
        worker_id: worker.id,
        summary: `Queued task ${taskRecord.id}.`,
        payload: {},
      });
      return taskRecord;
    });

    const permissionResult = await this.permissionEngine.applyPermissionGate(createdTask);
    if (permissionResult === "allow") {
      await this.scheduler.schedule();
    }

    const finalStatus = await this.scheduler.taskStatus(createdTask.id);

    return {
      task_id: createdTask.id,
      worker_id: createdTask.worker_id,
      status: finalStatus,
    };
  }

  async getStatus(input: GetStatusInput): Promise<Record<string, unknown>> {
    const state = await this.store.readState();

    if (input.all) {
      return {
        workers: Object.values(state.workers),
        tasks: Object.values(state.tasks),
      };
    }

    if (input.task_id) {
      const task = state.tasks[input.task_id];
      if (!task) {
        throw new Error(`Task not found: ${input.task_id}`);
      }
      return {
        task_id: task.id,
        worker_id: task.worker_id,
        role: task.role,
        status: task.status,
        runner_pid: task.runner_pid,
        claude_pid: task.claude_pid,
        project_id: task.project_id,
        target_task_id: task.target_task_id ?? null,
        worktree_path: task.worktree_path ?? null,
        patch_path: task.patch_path ?? null,
        started_at: task.started_at ?? null,
        finished_at: task.finished_at ?? null,
        updated_at: task.updated_at,
      };
    }

    if (input.worker_id) {
      const worker = state.workers[input.worker_id];
      if (!worker) {
        throw new Error(`Worker not found: ${input.worker_id}`);
      }
      return {
        worker_id: worker.id,
        role: worker.role,
        status: worker.status,
        project_id: worker.project_id,
        project_path: worker.project_path,
        worktree_path: worker.worktree_path ?? null,
        worktree_mode: worker.worktree_mode ?? null,
        current_task_id: worker.current_task_id ?? null,
        created_at: worker.created_at,
        updated_at: worker.updated_at,
      };
    }

    throw new Error("cc_get_status requires task_id or worker_id.");
  }

  async listTasks(input: ListTasksInput): Promise<{ tasks: TaskRecord[] }> {
    const state = await this.store.readState();
    return {
      tasks: Object.values(state.tasks).filter((task) => {
        if (input.project_id && task.project_id !== input.project_id) {
          return false;
        }
        if (input.status && task.status !== input.status) {
          return false;
        }
        if (input.worker_id && task.worker_id !== input.worker_id) {
          return false;
        }
        return true;
      }),
    };
  }

  async getReport(input: GetReportInput): Promise<TaskReport> {
    const state = await this.store.readState();
    const task = state.tasks[input.task_id];
    if (!task) {
      throw new Error(`Task not found: ${input.task_id}`);
    }

    if (FINAL_STATUSES.has(task.status)) {
      const savedReport = await readJsonReport(task.report_path).catch(() => undefined);
      if (savedReport) {
        return savedReport;
      }
    }

    const { stdout, stderr } = await this.readTaskOutput(task.id);
    return buildTaskReport({
      task,
      stdout,
      stderr,
      status: task.status,
      summary: task.summary ?? summarizeTaskReport(task.status, stdout, stderr),
    });
  }

  async stopTask(input: StopTaskInput): Promise<{
    task_id: string;
    status: TaskStatus;
    message: string;
  }> {
    const timestamp = nowIso();
    let pidToStop: number | undefined;
    let alreadyFinal = false;

    await this.store.updateState((state) => {
      const task = state.tasks[input.task_id];
      if (!task) {
        throw new Error(`Task not found: ${input.task_id}`);
      }
      alreadyFinal = FINAL_STATUSES.has(task.status);
      if (alreadyFinal) {
        return;
      }

      task.status = "stopped";
      task.stop_reason = input.reason ?? "Task stopped by request.";
      task.updated_at = timestamp;
      task.finished_at = timestamp;
      task.duration_ms = task.started_at
        ? new Date(timestamp).getTime() - new Date(task.started_at).getTime()
        : 0;
      task.summary = "Task was stopped before completion. Partial output was captured.";
      pidToStop = task.claude_pid ?? task.runner_pid;

      const worker = state.workers[task.worker_id];
      if (worker) {
        worker.status = "idle";
        delete worker.current_task_id;
        worker.updated_at = timestamp;
      }
      appendEvent(state, {
        type: "task_stopped",
        project_id: task.project_id,
        task_id: task.id,
        worker_id: task.worker_id,
        summary: `Task ${task.id} stopped.`,
        payload: { reason: task.stop_reason },
      });
    });

    if (alreadyFinal) {
      return {
        task_id: input.task_id,
        status: (await this.store.readState()).tasks[input.task_id]?.status ?? "stopped",
        message: "Task is already finished.",
      };
    }

    let stopMessage = "Task marked as stopped.";
    if (pidToStop) {
      const stopResult = this.processManager.stopPid(pidToStop);
      stopMessage = stopResult.message;
    }

    await this.writeInterimReport(input.task_id);
    await this.scheduler.schedule();
    return {
      task_id: input.task_id,
      status: "stopped",
      message: stopMessage,
    };
  }

  async stopWorker(input: { worker_id: string; reason?: string }): Promise<Record<string, unknown>> {
    const state = await this.store.readState();
    const worker = state.workers[input.worker_id];
    if (!worker) {
      throw new Error(`Worker not found: ${input.worker_id}`);
    }

    if (worker.current_task_id) {
      const stopped = await this.stopTask({
        task_id: worker.current_task_id,
        reason: input.reason ?? "Worker stopped by request.",
      });
      await this.store.updateState((latest) => {
        const latestWorker = latest.workers[input.worker_id];
        if (latestWorker) {
          latestWorker.status = "stopped";
          latestWorker.updated_at = nowIso();
          delete latestWorker.current_task_id;
        }
      });
      return {
        worker_id: input.worker_id,
        status: "stopped",
        stopped_task_id: stopped.task_id,
        message: stopped.message,
      };
    }

    await this.store.updateState((latest) => {
      const latestWorker = latest.workers[input.worker_id];
      if (!latestWorker) {
        throw new Error(`Worker not found: ${input.worker_id}`);
      }
      latestWorker.status = "stopped";
      latestWorker.updated_at = nowIso();
      delete latestWorker.current_task_id;
    });

    return {
      worker_id: input.worker_id,
      status: "stopped",
      message: "Worker stopped.",
    };
  }

  private async writeInterimReport(taskId: string): Promise<void> {
    const report = await this.getReport({ task_id: taskId });
    const paths = this.store.taskPaths(taskId);
    await writeFile(paths.reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

  private async readTaskOutput(taskId: string): Promise<{ stdout: string; stderr: string }> {
    const paths = this.store.taskPaths(taskId);
    const [stdout, stderr] = await Promise.all([
      readFile(paths.stdoutPath, "utf8").catch(() => ""),
      readFile(paths.stderrPath, "utf8").catch(() => ""),
    ]);
    return { stdout, stderr };
  }
}

function reportTypeForRole(role: TaskRecord["role"]): TaskRecord["report_type"] {
  if (role === "implementer") {
    return "implementation";
  }
  if (role === "tester") {
    return "test";
  }
  if (role === "reviewer") {
    return "review";
  }
  if (role === "scout") {
    return "scout";
  }
  return "task";
}

function defaultWorktreeMode(role: TaskRecord["role"]): TaskRecord["worktree_mode"] {
  if (role === "implementer") {
    return "isolated";
  }
  if (role === "scout" || role === "reviewer") {
    return "readonly";
  }
  return "direct";
}

function normalizeTask(task: string): string {
  if (!task || typeof task !== "string") {
    throw new Error("task is required and must be a non-empty string.");
  }
  return task;
}

function normalizeTimeout(timeoutSec = DEFAULT_TIMEOUT_SEC): number {
  if (!Number.isInteger(timeoutSec) || timeoutSec <= 0 || timeoutSec > MAX_TIMEOUT_SEC) {
    throw new Error(`timeout_sec must be an integer between 1 and ${MAX_TIMEOUT_SEC}.`);
  }
  return timeoutSec;
}

async function readJsonReport(reportPath: string): Promise<TaskReport> {
  const raw = await readFile(reportPath, "utf8");
  return JSON.parse(raw) as TaskReport;
}
