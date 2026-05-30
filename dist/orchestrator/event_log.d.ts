import type { EventRecord, GetUpdatesInput } from "../types.js";
import { StateStore } from "./state_store.js";
export declare class EventLog {
    private readonly store;
    constructor(store: StateStore);
    append(event: Omit<EventRecord, "event_id" | "time">): Promise<EventRecord>;
    getUpdates(input: GetUpdatesInput): Promise<{
        events: EventRecord[];
    }>;
}
