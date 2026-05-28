import { createRuntime } from "../orchestrator/runtime.js";
import type { StopWorkerInput } from "../types.js";

export async function ccStopWorker(input: StopWorkerInput) {
  const runtime = createRuntime();
  return runtime.tasks.stopWorker(input);
}
