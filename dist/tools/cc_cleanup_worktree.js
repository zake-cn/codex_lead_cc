import { createCodexLeadService } from "../services/codex_lead_service.js";
export async function ccCleanupWorktree(input) {
    return createCodexLeadService().cleanupWorktree(input);
}
//# sourceMappingURL=cc_cleanup_worktree.js.map