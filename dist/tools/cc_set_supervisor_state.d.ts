import type { SetSupervisorStateInput } from "../types.js";
export declare function ccSetSupervisorState(input: SetSupervisorStateInput): Promise<{
    ok: true;
    state: import("../types.js").SupervisorStateValue;
    updated_at: string;
}>;
