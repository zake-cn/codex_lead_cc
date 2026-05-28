import { createRuntime } from "../orchestrator/runtime.js";
import type { DeleteWorkerInput } from "../types.js";

export async function ccDeleteWorker(input: DeleteWorkerInput) {
  const runtime = createRuntime();
  return runtime.workers.deleteWorker(input);
}
