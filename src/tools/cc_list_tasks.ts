import { createCodexLeadService } from "../services/codex_lead_service.js";
import type { ListTasksInput } from "../types.js";

export async function ccListTasks(input: ListTasksInput) {
  return createCodexLeadService().listTasks(input);
}
