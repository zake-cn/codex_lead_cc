import type { DeleteWorkerInput } from "../types.js";
export declare function ccDeleteWorker(input: DeleteWorkerInput): Promise<{
    worker_id: string;
    deleted: true;
}>;
