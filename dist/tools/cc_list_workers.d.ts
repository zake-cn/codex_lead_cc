import type { ListWorkersInput } from "../types.js";
export declare function ccListWorkers(input: ListWorkersInput): Promise<{
    workers: import("../types.js").WorkerRecord[];
}>;
