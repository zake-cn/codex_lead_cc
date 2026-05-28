import { createCodexLeadService } from "../services/codex_lead_service.js";
import type { GetDiffSummaryInput } from "../types.js";

export async function ccGetDiffSummary(input: GetDiffSummaryInput) {
  return createCodexLeadService().getDiffSummary(input);
}
