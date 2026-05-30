import type { AgentForemanState, EventRecord, SupervisorNotificationRecord, WakeEventType, WakePriority } from "../types.js";
export declare function buildNotificationFromEvent(state: AgentForemanState, event: EventRecord): Omit<SupervisorNotificationRecord, "notification_id" | "read" | "created_at"> | undefined;
export declare function defaultWakeTypes(): WakeEventType[];
export declare function comparePriority(a: WakePriority, b: WakePriority): number;
export declare function highestPriority(notifications: Array<{
    priority: WakePriority;
}>): WakePriority;
export declare function priorityRank(priority: WakePriority): number;
