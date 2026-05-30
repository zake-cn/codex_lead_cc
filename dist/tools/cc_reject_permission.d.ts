import type { RejectPermissionInput } from "../types.js";
export declare function ccRejectPermission(input: RejectPermissionInput): Promise<{
    request_id: string;
    status: "rejected";
    reason: string;
    task_id: string;
}>;
