import { stat, writeFile } from "node:fs/promises";

import type { MetricsInput, MetricsReport, TaskRecord, WorkerRuntime } from "../types.js";
import { appendEvent, StateStore } from "./state_store.js";

export class MetricsCollector {
  constructor(private readonly store: StateStore) {}

  async getMetrics(input: MetricsInput): Promise<MetricsReport & { metrics_path: string }> {
    const state = await this.store.readState();
    const plan = input.plan_id ? state.plans[input.plan_id] : undefined;
    if (input.plan_id && !plan) {
      throw new Error(`Plan not found: ${input.plan_id}`);
    }

    const taskIdsFromPlan = new Set(plan?.tasks.map((task) => task.task_id).filter((taskId): taskId is string => Boolean(taskId)) ?? []);
    const tasks = Object.values(state.tasks).filter((task) => {
      if (input.project_id && task.project_id !== input.project_id) {
        return false;
      }
      if (input.plan_id) {
        return task.plan_id === input.plan_id || taskIdsFromPlan.has(task.id);
      }
      return true;
    });

    const rawLogBytes = await sumFileSizes(tasks, (task) => [this.store.taskPaths(task.id).logPath, this.store.taskPaths(task.id).stdoutPath, this.store.taskPaths(task.id).stderrPath]);
    const reportBytes = await sumFileSizes(tasks, (task) => [this.store.taskPaths(task.id).reportPath]);
    const tasksCompleted = tasks.filter((task) => task.status === "completed").length;
    const tasksFailed = tasks.filter((task) => ["failed", "timeout", "stopped", "skipped"].includes(task.status)).length;
    const totalRuntimeMs = tasks.reduce((sum, task) => sum + (task.duration_ms ?? 0), 0);
    const workerRuntime: Record<WorkerRuntime, number> = {
      claude_cli: 0,
      claude_sdk: 0,
    };
    for (const task of tasks) {
      workerRuntime[task.runtime ?? "claude_cli"] += 1;
    }

    const report: MetricsReport = {
      project_id: input.project_id ?? plan?.project_id,
      plan_id: input.plan_id,
      tasks_total: tasks.length,
      tasks_completed: tasksCompleted,
      tasks_failed: tasksFailed,
      tasks_running: tasks.filter((task) => task.status === "running").length,
      success_rate: tasks.length === 0 ? 0 : tasksCompleted / tasks.length,
      total_runtime_ms: totalRuntimeMs,
      raw_log_bytes: rawLogBytes,
      structured_report_bytes: reportBytes,
      compression_ratio: reportBytes > 0 ? Number((rawLogBytes / reportBytes).toFixed(2)) : 0,
      workers_total: new Set(tasks.map((task) => task.worker_id)).size,
      worker_runtime: workerRuntime,
      permission_requests: Object.values(state.permission_requests).filter((request) =>
        tasks.some((task) => task.id === request.task_id),
      ).length,
      patches_generated: tasks.filter((task) => Boolean(task.patch_path) && task.role === "implementer").length,
      estimated_supervisor_context_saved: estimateContextSaved(rawLogBytes, reportBytes),
    };

    const scope = input.plan_id ?? input.project_id ?? "all";
    const paths = this.store.metricsPath(scope);
    await writeFile(paths.metricsPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    await this.store.updateState((latest) => {
      appendEvent(latest, {
        type: "metrics_collected",
        project_id: report.project_id,
        summary: `Collected metrics for ${scope}.`,
        payload: { ...report, metrics_path: paths.displayMetricsPath },
      });
    });

    return {
      ...report,
      metrics_path: paths.displayMetricsPath,
    };
  }
}

async function sumFileSizes(tasks: TaskRecord[], pathsForTask: (task: TaskRecord) => string[]): Promise<number> {
  let total = 0;
  for (const task of tasks) {
    for (const filePath of pathsForTask(task)) {
      const fileStat = await stat(filePath).catch(() => undefined);
      total += fileStat?.size ?? 0;
    }
  }
  return total;
}

function estimateContextSaved(rawLogBytes: number, reportBytes: number): MetricsReport["estimated_supervisor_context_saved"] {
  if (reportBytes === 0 || rawLogBytes === 0) {
    return "low";
  }
  const ratio = rawLogBytes / reportBytes;
  if (ratio >= 10) {
    return "high";
  }
  if (ratio >= 3) {
    return "medium";
  }
  return "low";
}
