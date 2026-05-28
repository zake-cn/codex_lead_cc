import { createRuntime } from "../orchestrator/runtime.js";
import type { CleanupIdleWorkersInput } from "../types.js";

export async function ccCleanupIdleWorkers(input: CleanupIdleWorkersInput) {
  const runtime = createRuntime();
  return runtime.sessions.cleanupIdleWorkers(input);
}
