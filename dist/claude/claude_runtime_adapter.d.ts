import { StateStore } from "../orchestrator/state_store.js";
import type { ClaudeCliRunOptions, ClaudeCliRunResult, RunningClaudeCli, StartTaskInput, WorkerRuntime } from "../types.js";
export interface RunningClaudeTask {
    runtime: WorkerRuntime;
    running: RunningClaudeCli;
}
export declare function startClaudeTask(store: StateStore, input: StartTaskInput): Promise<RunningClaudeTask>;
export declare function runClaudeTaskOnce(input: ClaudeCliRunOptions): Promise<ClaudeCliRunResult>;
