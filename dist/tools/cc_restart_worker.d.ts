import type { RestartWorkerInput } from "../types.js";
export declare function ccRestartWorker(input: RestartWorkerInput): Promise<{
    worker_id: string;
    status: import("../types.js").WorkerRecord["status"];
    session_id: string;
    message: string;
}>;
