import type { GetSupervisorStateInput, SetSupervisorStateInput, SupervisorStateRecord, SupervisorStateValue } from "../types.js";
import { StateStore } from "./state_store.js";
export declare class SupervisorStateManager {
    private readonly store;
    constructor(store: StateStore);
    setState(input: SetSupervisorStateInput): Promise<{
        ok: true;
        state: SupervisorStateValue;
        updated_at: string;
    }>;
    getState(input: GetSupervisorStateInput): Promise<SupervisorStateRecord>;
}
export declare function supervisorStateKey(projectId: string, planId?: string): string;
