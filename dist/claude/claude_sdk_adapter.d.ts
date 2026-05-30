import type { ClaudeCodeAdapter, StartTaskInput, StartTaskResult, StopTaskResult, TaskRuntimeStatus } from "../types.js";
import { StateStore } from "../orchestrator/state_store.js";
export declare class ClaudeSdkAdapter implements ClaudeCodeAdapter {
    private readonly store;
    private readonly fallback;
    readonly runtime: "claude_sdk";
    constructor(store: StateStore, fallback: ClaudeCodeAdapter);
    startTask(input: StartTaskInput): Promise<StartTaskResult>;
    stopTask(taskId: string): Promise<StopTaskResult>;
    getStatus(taskId: string): Promise<TaskRuntimeStatus>;
    cleanup(workerId: string): Promise<void>;
}
