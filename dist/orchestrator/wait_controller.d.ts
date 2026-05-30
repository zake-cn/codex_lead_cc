import type { SupervisorNotificationRecord, WaitForEventsInput, WakePacket } from "../types.js";
import { StateStore } from "./state_store.js";
export declare class WaitController {
    private readonly store;
    private readonly inbox;
    constructor(store: StateStore);
    waitForEvents(input: WaitForEventsInput): Promise<WakePacket>;
    getWakeCandidates(input: WaitForEventsInput): Promise<SupervisorNotificationRecord[]>;
}
