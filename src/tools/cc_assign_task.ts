import { createRuntime } from "../orchestrator/runtime.js";
import type { AssignTaskInput } from "../types.js";

export async function ccAssignTask(input: AssignTaskInput) {
  const runtime = createRuntime();
  return runtime.tasks.assignTask(input);
}
