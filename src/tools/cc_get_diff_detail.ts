import { createRuntime } from "../orchestrator/runtime.js";
import type { GetDiffDetailInput } from "../types.js";

export async function ccGetDiffDetail(input: GetDiffDetailInput) {
  const runtime = createRuntime();
  return runtime.diffs.getDetail(input);
}
