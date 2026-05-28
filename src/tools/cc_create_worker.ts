import { createRuntime } from "../orchestrator/runtime.js";
import type { CreateWorkerInput } from "../types.js";

export async function ccCreateWorker(input: CreateWorkerInput) {
  const runtime = createRuntime();
  return runtime.workers.createWorker(input);
}
