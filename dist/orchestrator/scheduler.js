import { loadConfig } from "../config/load_config.js";
import { appendEvent, nowIso } from "./state_store.js";
import { DagScheduler } from "./dag_scheduler.js";
import { syncLinkedPlanTask } from "./plan_state.js";
import { setWorkerTaskState } from "./worker_state.js";
export class Scheduler {
    store;
    processManager;
    dagScheduler;
    permissionEngine;
    constructor(store, processManager, dagScheduler = new DagScheduler(), permissionEngine) {
        this.store = store;
        this.processManager = processManager;
        this.dagScheduler = dagScheduler;
        this.permissionEngine = permissionEngine;
    }
    async schedule() {
        const config = await loadConfig();
        const maxConcurrent = config.max_concurrent_workers;
        const startedTaskIds = [];
        await this.store.updateState((state) => {
            this.dagScheduler.updateReadiness(state);
        });
        if (this.permissionEngine) {
            const readyTasks = Object.values((await this.store.readState()).tasks)
                .filter((task) => task.status === "ready")
                .sort((a, b) => a.created_at.localeCompare(b.created_at));
            for (const task of readyTasks) {
                await this.permissionEngine.applyPermissionGate(task);
            }
        }
        const running = await this.store.updateState((state) => {
            this.dagScheduler.updateReadiness(state);
            const runningCount = Object.values(state.tasks).filter((task) => task.status === "running").length;
            let slots = Math.max(0, maxConcurrent - runningCount);
            if (slots === 0) {
                return runningCount;
            }
            const pendingTasks = Object.values(state.tasks)
                .filter((task) => task.status === "ready")
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
                syncLinkedPlanTask(state, task);
                setWorkerTaskState({ state, worker, status: "running", timestamp, currentTaskId: task.id });
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
    async taskStatus(taskId) {
        const state = await this.store.readState();
        const task = state.tasks[taskId];
        if (!task) {
            throw new Error(`Task not found: ${taskId}`);
        }
        return task.status;
    }
}
//# sourceMappingURL=scheduler.js.map