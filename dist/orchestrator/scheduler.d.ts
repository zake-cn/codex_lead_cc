import type { TaskStatus } from "../types.js";
import { StateStore } from "./state_store.js";
import { ProcessManager } from "./process_manager.js";
import { DagScheduler } from "./dag_scheduler.js";
import { PermissionEngine } from "./permission_engine.js";
export declare class Scheduler {
    private readonly store;
    private readonly processManager;
    private readonly dagScheduler;
    private readonly permissionEngine?;
    constructor(store: StateStore, processManager: ProcessManager, dagScheduler?: DagScheduler, permissionEngine?: PermissionEngine | undefined);
    schedule(): Promise<{
        started_task_ids: string[];
        running: number;
        max_concurrent_workers: number;
    }>;
    taskStatus(taskId: string): Promise<TaskStatus>;
}
