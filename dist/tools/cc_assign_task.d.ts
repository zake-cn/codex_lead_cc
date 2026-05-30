import type { AssignTaskInput } from "../types.js";
export declare function ccAssignTask(input: AssignTaskInput): Promise<{
    task_id: string;
    worker_id: string;
    status: import("../types.js").TaskStatus;
}>;
