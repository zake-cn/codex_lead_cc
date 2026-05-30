import type { ApprovePermissionInput, PermissionDecision, PermissionRequestRecord, RejectPermissionInput, TaskRecord } from "../types.js";
import { StateStore } from "./state_store.js";
export declare class PermissionEngine {
    private readonly store;
    constructor(store: StateStore);
    getPendingPermissions(input: {
        project_id?: string;
    }): Promise<{
        pending_permissions: PermissionRequestRecord[];
    }>;
    approve(input: ApprovePermissionInput): Promise<{
        request_id: string;
        status: "approved";
        decision: PermissionDecision;
        task_id: string;
    }>;
    reject(input: RejectPermissionInput): Promise<{
        request_id: string;
        status: "rejected";
        reason: string;
        task_id: string;
    }>;
    applyPermissionGate(task: TaskRecord): Promise<"allow" | "waiting_permission" | "denied">;
}
