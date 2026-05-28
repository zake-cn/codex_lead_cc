import type { ClaudeCodeAdapter, WorkerRuntime } from "../types.js";
import { StateStore } from "../orchestrator/state_store.js";
import { ClaudeCliAdapter } from "./claude_cli_adapter.js";
import { ClaudeSdkAdapter } from "./claude_sdk_adapter.js";

export function createClaudeCodeAdapter(runtime: WorkerRuntime, store: StateStore): ClaudeCodeAdapter {
  if (runtime === "claude_sdk") {
    return new ClaudeSdkAdapter(store, new ClaudeCliAdapter(store));
  }
  return new ClaudeCliAdapter(store);
}
