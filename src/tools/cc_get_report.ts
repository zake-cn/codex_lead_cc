import { createCodexLeadService } from "../services/codex_lead_service.js";
import type { GetReportInput } from "../types.js";

export async function ccGetReport(input: GetReportInput) {
  return createCodexLeadService().getReport(input);
}
