import type { GetUpdatesInput } from "../types.js";
export declare function ccGetUpdates(input: GetUpdatesInput): Promise<{
    events: import("../types.js").EventRecord[];
}>;
