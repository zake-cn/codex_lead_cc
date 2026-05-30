import type { GetWorkerHealthInput } from "../types.js";
export declare function ccGetWorkerHealth(input: GetWorkerHealthInput): Promise<{
    workers: import("../types.js").WorkerHealthReport[];
}>;
