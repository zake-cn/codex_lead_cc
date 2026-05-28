import { createRuntime } from "../orchestrator/runtime.js";
import type { ListPlansInput } from "../types.js";

export async function ccListPlans(input: ListPlansInput) {
  const runtime = createRuntime();
  return runtime.plans.listPlans(input);
}
