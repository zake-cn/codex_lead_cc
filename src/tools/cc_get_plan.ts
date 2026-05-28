import { createRuntime } from "../orchestrator/runtime.js";
import type { GetPlanInput } from "../types.js";

export async function ccGetPlan(input: GetPlanInput) {
  const runtime = createRuntime();
  return runtime.plans.getPlan(input);
}
