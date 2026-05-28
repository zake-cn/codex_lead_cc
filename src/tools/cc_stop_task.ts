import { createRuntime } from "../orchestrator/runtime.js";
import type { StopTaskInput } from "../types.js";

export async function ccStopTask(input: StopTaskInput) {
  const runtime = createRuntime();
  return runtime.tasks.stopTask(input);
}
