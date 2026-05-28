import { createRuntime } from "../orchestrator/runtime.js";
import type { ApprovePermissionInput } from "../types.js";

export async function ccApprovePermission(input: ApprovePermissionInput) {
  const runtime = createRuntime();
  const result = await runtime.permissions.approve(input);
  await runtime.scheduler.schedule();
  return result;
}
