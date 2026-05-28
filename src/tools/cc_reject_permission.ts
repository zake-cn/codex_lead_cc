import { createRuntime } from "../orchestrator/runtime.js";
import type { RejectPermissionInput } from "../types.js";

export async function ccRejectPermission(input: RejectPermissionInput) {
  const runtime = createRuntime();
  const result = await runtime.permissions.reject(input);
  await runtime.scheduler.schedule();
  return result;
}
