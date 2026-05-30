import type { GetDiffDetailInput } from "../types.js";
export declare function ccGetDiffDetail(input: GetDiffDetailInput): Promise<{
    task_id: string;
    file: string;
    diff: string;
}>;
