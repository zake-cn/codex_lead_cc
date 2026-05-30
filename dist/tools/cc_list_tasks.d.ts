import type { ListTasksInput } from "../types.js";
export declare function ccListTasks(input: ListTasksInput): Promise<{
    tasks: import("../types.js").TaskRecord[];
}>;
