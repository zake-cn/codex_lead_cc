import { createRuntime } from "../orchestrator/runtime.js";
import type { UpdatePlanInput } from "../types.js";

export async function ccUpdatePlan(input: UpdatePlanInput) {
  const runtime = createRuntime();
  return runtime.plans.updatePlan(input);
}
