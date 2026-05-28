import { createCodexLeadService } from "../services/codex_lead_service.js";
import type { GetDiffDetailInput } from "../types.js";

export async function ccGetDiffDetail(input: GetDiffDetailInput) {
  return createCodexLeadService().getDiffDetail(input);
}
