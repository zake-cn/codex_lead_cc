import type { GetInboxInput } from "../types.js";
export declare function ccGetInbox(input: GetInboxInput): Promise<{
    notifications: import("../types.js").SupervisorNotificationRecord[];
}>;
