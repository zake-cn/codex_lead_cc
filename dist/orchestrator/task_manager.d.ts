import type { AssignTaskInput, GetReportInput, GetStatusInput, ListTasksInput, StopTaskInput, TaskRecord, TaskReport, TaskStatus } from "../types.js";
import { StateStore } from "./state_store.js";
import { ProcessManager } from "./process_manager.js";
import { Scheduler } from "./scheduler.js";
export declare class TaskManager {
    private readonly store;
    private readonly processManager;
    private readonly scheduler;
    constructor(store: StateStore, processManager: ProcessManager, scheduler: Scheduler);
    assignTask(input: AssignTaskInput): Promise<{
        task_id: string;
        worker_id: string;
        status: TaskStatus;
    }>;
    getStatus(input: GetStatusInput): Promise<Record<string, unknown>>;
    listTasks(input: ListTasksInput): Promise<{
        tasks: TaskRecord[];
    }>;
    getReport(input: GetReportInput): Promise<TaskReport>;
    stopTask(input: StopTaskInput): Promise<{
        task_id: string;
        status: TaskStatus;
        message: string;
    }>;
    stopWorker(input: {
        worker_id: string;
        reason?: string;
    }): Promise<Record<string, unknown>>;
    private writeInterimReport;
    private readTaskOutput;
}
