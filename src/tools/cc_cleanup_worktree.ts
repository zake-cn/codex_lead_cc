import { createCodexLeadService } from "../services/codex_lead_service.js";
import type { CleanupWorktreeInput } from "../types.js";

export async function ccCleanupWorktree(input: CleanupWorktreeInput) {
  return createCodexLeadService().cleanupWorktree(input);
}
