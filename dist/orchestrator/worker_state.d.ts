import type { AgentForemanState, WorkerRecord, WorkerStatus } from "../types.js";
export declare function setWorkerTaskState(args: {
    state: AgentForemanState;
    worker: WorkerRecord;
    status: WorkerStatus;
    timestamp: string;
    currentTaskId?: string;
}): void;
export declare function sessionStatusForWorker(status: WorkerStatus): "idle" | "busy" | "stopped" | "crashed";
