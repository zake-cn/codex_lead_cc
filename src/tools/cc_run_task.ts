import { createCodexLeadService } from "../services/codex_lead_service.js";
import type { CcRunTaskInput, CcRunTaskReport } from "../types.js";

export async function ccRunTask(input: CcRunTaskInput): Promise<CcRunTaskReport> {
  return createCodexLeadService().runTask(input);
}
