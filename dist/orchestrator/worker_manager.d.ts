import type { CreateWorkerInput, DeleteWorkerInput, ListWorkersInput, WorkerRuntime, WorkerRecord, WorkerRole, WorkerStatus } from "../types.js";
import { StateStore } from "./state_store.js";
export declare class WorkerManager {
    private readonly store;
    constructor(store: StateStore);
    createWorker(input: CreateWorkerInput): Promise<WorkerRecord>;
    getWorker(workerId: string): Promise<WorkerRecord>;
    setWorkerStatus(args: {
        workerId: string;
        status: WorkerStatus;
        currentTaskId?: string;
    }): Promise<WorkerRecord>;
    deleteWorker(input: DeleteWorkerInput): Promise<{
        worker_id: string;
        deleted: true;
    }>;
    listWorkers(input: ListWorkersInput): Promise<{
        workers: WorkerRecord[];
    }>;
}
export declare function normalizeRole(role: string): WorkerRole;
export declare function normalizeRuntime(runtime: string): WorkerRuntime;
