import { createRuntime } from "../orchestrator/runtime.js";
import type { CreatePlanInput } from "../types.js";

export async function ccCreatePlan(input: CreatePlanInput) {
  const runtime = createRuntime();
  return runtime.plans.createPlan(input);
}
