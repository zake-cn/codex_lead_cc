import type { ClaudeCodeAdapter, WorkerRuntime } from "../types.js";
import { StateStore } from "../orchestrator/state_store.js";
export declare function createClaudeCodeAdapter(runtime: WorkerRuntime, store: StateStore): ClaudeCodeAdapter;
