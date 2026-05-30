import type { GetPendingPermissionsInput } from "../types.js";
export declare function ccGetPendingPermissions(input: GetPendingPermissionsInput): Promise<{
    pending_permissions: import("../types.js").PermissionRequestRecord[];
}>;
