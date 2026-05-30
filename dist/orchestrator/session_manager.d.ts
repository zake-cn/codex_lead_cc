import type { CleanupIdleWorkersInput, GetWorkerHealthInput, RestartWorkerInput, WorkerHealthReport, WorkerRecord } from "../types.js";
import { StateStore } from "./state_store.js";
export declare class SessionManager {
    private readonly store;
    constructor(store: StateStore);
    getWorkerHealth(input: GetWorkerHealthInput): Promise<{
        workers: WorkerHealthReport[];
    }>;
    restartWorker(input: RestartWorkerInput): Promise<{
        worker_id: string;
        status: WorkerRecord["status"];
        session_id: string;
        message: string;
    }>;
    cleanupIdleWorkers(input: CleanupIdleWorkersInput): Promise<{
        dry_run: boolean;
        cleaned_worker_ids: string[];
    }>;
}
