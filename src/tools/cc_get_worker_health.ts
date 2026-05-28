import { createRuntime } from "../orchestrator/runtime.js";
import type { GetWorkerHealthInput } from "../types.js";

export async function ccGetWorkerHealth(input: GetWorkerHealthInput) {
  const runtime = createRuntime();
  return runtime.sessions.getWorkerHealth(input);
}
