import { createCodexLeadService } from "../services/codex_lead_service.js";

export async function ccDispatch(input: Record<string, unknown>) {
  return createCodexLeadService().dispatch(input);
}
