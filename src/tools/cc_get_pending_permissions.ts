import { createRuntime } from "../orchestrator/runtime.js";
import type { GetPendingPermissionsInput } from "../types.js";

export async function ccGetPendingPermissions(input: GetPendingPermissionsInput) {
  const runtime = createRuntime();
  return runtime.permissions.getPendingPermissions(input);
}
