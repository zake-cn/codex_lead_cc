import { loadConfig } from "../config/load_config.js";
import type { TaskStatus } from "../types.js";
import { appendEvent, nowIso, StateStore } from "./state_store.js";
import { ProcessManager } from "./process_manager.js";

export class Scheduler {
  constructor(
    private readonly store: StateStore,
    private readonly processManager: ProcessManager,
  ) {}

  async schedule(): Promise<{ started_task_ids: string[]; running: number; max_concurrent_workers: number }> {
    const config = await loadConfig();
    const maxConcurrent = config.max_concurrent_workers;
    const startedTaskIds: string[] = [];

    const running = await this.store.updateState((state) => {
      const runningCount = Object.values(state.tasks).filter((task) => task.status === "running").length;
      let slots = Math.max(0, maxConcurrent - runningCount);
      if (slots === 0) {
        return runningCount;
      }

      const pendingTasks = Object.values(state.tasks)
        .filter((task) => task.status === "pending")
        .sort((a, b) => a.created_at.localeCompare(b.created_at));

      for (const task of pendingTasks) {
        if (slots <= 0) {
          break;
        }
        const worker = state.workers[task.worker_id];
        if (!worker || worker.status === "stopped") {
          continue;
        }

        const runnerPid = this.processManager.startTaskWorker(task.id, this.store.rootDir);
        const timestamp = nowIso();
        task.status = "running";
        task.runner_pid = runnerPid;
        task.updated_at = timestamp;
        worker.status = "running";
        worker.current_task_id = task.id;
        worker.updated_at = timestamp;
        appendEvent(state, {
          type: "task_started",
          project_id: task.project_id,
          task_id: task.id,
          worker_id: task.worker_id,
          summary: `Task ${task.id} started for worker ${task.worker_id}.`,
          payload: { runner_pid: runnerPid },
        });
        startedTaskIds.push(task.id);
        slots -= 1;
      }

      return Object.values(state.tasks).filter((task) => task.status === "running").length;
    });

    return {
      started_task_ids: startedTaskIds,
      running,
      max_concurrent_workers: maxConcurrent,
    };
  }

  async taskStatus(taskId: string): Promise<TaskStatus> {
    const state = await this.store.readState();
    const task = state.tasks[taskId];
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    return task.status;
  }
}
