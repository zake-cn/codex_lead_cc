import type { ApprovePermissionInput } from "../types.js";
export declare function ccApprovePermission(input: ApprovePermissionInput): Promise<{
    request_id: string;
    status: "approved";
    decision: import("../types.js").PermissionDecision;
    task_id: string;
}>;
