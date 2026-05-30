import type { StopTaskInput } from "../types.js";
export declare function ccStopTask(input: StopTaskInput): Promise<{
    task_id: string;
    status: import("../types.js").TaskStatus;
    message: string;
}>;
