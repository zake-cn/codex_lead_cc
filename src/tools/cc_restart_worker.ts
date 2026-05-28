import { createRuntime } from "../orchestrator/runtime.js";
import type { RestartWorkerInput } from "../types.js";

export async function ccRestartWorker(input: RestartWorkerInput) {
  const runtime = createRuntime();
  return runtime.sessions.restartWorker(input);
}
