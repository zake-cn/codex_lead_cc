import type { ClaudeCodeAdapter, RunningClaudeCli, StartTaskInput, StartTaskResult, StopTaskResult, TaskRuntimeStatus } from "../types.js";
import { StateStore } from "../orchestrator/state_store.js";
export declare class ClaudeCliAdapter implements ClaudeCodeAdapter {
    private readonly store;
    readonly runtime: "claude_cli";
    private readonly running;
    constructor(store: StateStore);
    startTask(input: StartTaskInput): Promise<StartTaskResult>;
    stopTask(taskId: string): Promise<StopTaskResult>;
    getStatus(taskId: string): Promise<TaskRuntimeStatus>;
    cleanup(): Promise<void>;
}
export declare function startClaudeCliTask(store: StateStore, input: StartTaskInput): RunningClaudeCli;
