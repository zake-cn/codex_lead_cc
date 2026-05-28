import { createRuntime } from "../orchestrator/runtime.js";
import type { ListWorkersInput } from "../types.js";

export async function ccListWorkers(input: ListWorkersInput) {
  const runtime = createRuntime();
  return runtime.workers.listWorkers(input);
}
