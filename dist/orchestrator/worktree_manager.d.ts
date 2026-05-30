import type { CleanupWorktreeInput, TaskRecord } from "../types.js";
import { StateStore } from "./state_store.js";
export declare class WorktreeManager {
    private readonly store;
    constructor(store: StateStore);
    prepareTaskExecution(task: TaskRecord): Promise<{
        executionPath: string;
        worktreePath?: string;
        worktreeMode: "readonly" | "isolated" | "direct";
        baseBranch?: string;
    }>;
    cleanup(input: CleanupWorktreeInput): Promise<{
        cleaned: string[];
    }>;
}
