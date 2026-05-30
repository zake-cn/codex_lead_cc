import type { GetInboxInput, MarkNotificationsReadInput, SupervisorNotificationRecord, WakeEventType } from "../types.js";
import { StateStore } from "./state_store.js";
export declare class SupervisorInbox {
    private readonly store;
    constructor(store: StateStore);
    getInbox(input: GetInboxInput): Promise<{
        notifications: SupervisorNotificationRecord[];
    }>;
    markRead(input: MarkNotificationsReadInput): Promise<{
        marked_read: string[];
    }>;
    getWakeCandidates(input: {
        project_id?: string;
        plan_id?: string;
        since_event_id?: number;
        wake_on?: WakeEventType[];
        max_events?: number;
    }): Promise<SupervisorNotificationRecord[]>;
}
export declare function selectWakeCandidates(notifications: SupervisorNotificationRecord[], input: {
    project_id?: string;
    plan_id?: string;
    since_event_id?: number;
    wake_on?: WakeEventType[];
    max_events?: number;
}): SupervisorNotificationRecord[];
