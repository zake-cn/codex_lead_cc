import { createRuntime } from "../orchestrator/runtime.js";
import type { GetDiffSummaryInput } from "../types.js";

export async function ccGetDiffSummary(input: GetDiffSummaryInput) {
  const runtime = createRuntime();
  return runtime.diffs.getSummary(input);
}
