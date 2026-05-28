import { createRuntime } from "../orchestrator/runtime.js";
import type { GetStatusInput } from "../types.js";

export async function ccGetStatus(input: GetStatusInput) {
  const runtime = createRuntime();
  return runtime.tasks.getStatus(input);
}
