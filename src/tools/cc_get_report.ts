import { createRuntime } from "../orchestrator/runtime.js";
import type { GetReportInput } from "../types.js";

export async function ccGetReport(input: GetReportInput) {
  const runtime = createRuntime();
  return runtime.tasks.getReport(input);
}
