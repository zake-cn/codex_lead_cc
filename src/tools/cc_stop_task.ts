import { createCodexLeadService } from "../services/codex_lead_service.js";
import type { StopTaskInput } from "../types.js";

export async function ccStopTask(input: StopTaskInput) {
  return createCodexLeadService().stopTask(input);
}
