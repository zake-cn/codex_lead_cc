import { createRuntime } from "../orchestrator/runtime.js";
import type { CleanupWorktreeInput } from "../types.js";

export async function ccCleanupWorktree(input: CleanupWorktreeInput) {
  const runtime = createRuntime();
  return runtime.worktrees.cleanup(input);
}
