import { createRuntime } from "../orchestrator/runtime.js";
import type { ListTasksInput } from "../types.js";

export async function ccListTasks(input: ListTasksInput) {
  const runtime = createRuntime();
  return runtime.tasks.listTasks(input);
}
