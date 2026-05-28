import { createCodexLeadService } from "../services/codex_lead_service.js";
import type { WaitForEventsInput } from "../types.js";

export async function ccWaitForEvents(input: WaitForEventsInput) {
  return createCodexLeadService().waitForEvents(input);
}
